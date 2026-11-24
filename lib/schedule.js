// Reads and writes the published schedule: schedule/YYYY-MM.json, each an array of puzzle snapshots.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./content.js";

export const SCHEDULE_DIR = join(ROOT, "schedule");

export function loadSchedule(dir = SCHEDULE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort()
    .flatMap(f => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function saveSchedule(puzzles, dir = SCHEDULE_DIR) {
  mkdirSync(dir, { recursive: true });
  const byMonth = new Map();
  for (const p of puzzles) {
    const m = p.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(p);
  }
  for (const [m, list] of byMonth) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    // One puzzle per line keeps git diffs readable.
    writeFileSync(join(dir, `${m}.json`), "[\n" + list.map(p => JSON.stringify(p)).join(",\n") + "\n]\n");
  }
}
