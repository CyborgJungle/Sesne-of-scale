#!/usr/bin/env node
// npm run validate — schema and puzzle-quality checks for every scale. Exits 1 on errors (use in CI).
import { loadScales, validateScale } from "../lib/content.js";

const quiet = process.argv.includes("--quiet");
const scales = loadScales();
let errors = 0, warnings = 0;
const totals = { draft: 0, checked: 0, verified: 0, rejected: 0 };
const ids = new Set();

const rows = [];
for (const s of scales) {
  const v = validateScale(s);
  if (ids.has(s.id)) v.errors.push(`duplicate scale id ${s.id}`);
  ids.add(s.id);
  const c = { draft: 0, checked: 0, verified: 0, rejected: 0 };
  for (const it of s.items || []) c[it.status || "draft"]++;
  for (const k in c) totals[k] += c[k];
  rows.push([s.id, s.type, (s.items || []).length, c.verified, c.checked, c.draft, c.rejected]);
  errors += v.errors.length; warnings += v.warnings.length;
  if (v.errors.length || (!quiet && v.warnings.length)) {
    console.log(`\n${s.id}`);
    v.errors.forEach(e => console.log(`  ✗ ${e}`));
    if (!quiet) v.warnings.forEach(w => console.log(`  · ${w}`));
  }
}

console.log("\nscale                         type  items  verified checked draft rejected");
for (const r of rows) console.log(`${r[0].padEnd(30)}${r[1].padEnd(6)}${String(r[2]).padStart(5)}  ${[r[3], r[4], r[5], r[6]].map(n => String(n).padStart(8)).join("")}`);
console.log(`\n${scales.length} scales, ${Object.values(totals).reduce((a, b) => a + b, 0)} items ` +
  `(${totals.verified} verified, ${totals.checked} checked, ${totals.draft} draft, ${totals.rejected} rejected). ` +
  `${errors} errors, ${warnings} warnings.`);
process.exit(errors ? 1 : 0);
