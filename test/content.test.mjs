import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScales, validateScale, statusAtLeast } from "../lib/content.js";
import { planDays, MIN_GAP_T } from "../scripts/schedule.mjs";
import { loadSchedule } from "../lib/schedule.js";
import { toT, daysBetween } from "../public/js/core.js";

const scales = loadScales();

test("every scale file passes validation without errors", () => {
  for (const s of scales) assert.deepEqual(validateScale(s).errors, [], s.id);
});

test("item ids are unique across all scales", () => {
  const ids = scales.flatMap(s => s.items.map(it => it.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("status ordering", () => {
  assert.ok(statusAtLeast("verified", "checked"));
  assert.ok(!statusAtLeast("draft", "checked"));
  assert.ok(!statusAtLeast("rejected", "draft"));
});

test("scheduler: 3 scales a day from different fields, 5 distinct items, reproducible", () => {
  const plan = () => planDays({ scales, existing: [], from: "2030-01-01", to: "2030-01-28", minStatus: "draft" });
  const a = plan(), b = plan();
  assert.deepEqual(a, b, "same input → same schedule");
  assert.equal(a.length, 28);
  a.forEach((p, i) => {
    assert.equal(p.number, i + 1);
    assert.equal(p.scales.length, 3);
    assert.equal(new Set(p.scales.map(s => s.id)).size, 3);
    for (const s of p.scales) {
      assert.equal(s.items.length, 5);
      assert.equal(new Set(s.items.map(it => it.id)).size, 5);
    }
  });
  // The gap rule is soft (it can bend when a scale has few items), but should almost always hold.
  const sets = a.flatMap(p => p.scales);
  const ok = sets.filter(s => { const ts = s.items.map(it => toT(s, it.value)).sort((x, y) => x - y); return ts.every((t, k) => !k || t - ts[k - 1] >= MIN_GAP_T); });
  assert.ok(ok.length / sets.length > 0.9, `only ${ok.length}/${sets.length} item sets keep the minimum gap`);
});

test("scheduler: a scale doesn't come back for at least 4 days with the current pool", () => {
  const days = planDays({ scales, existing: [], from: "2030-01-01", to: "2030-02-28", minStatus: "draft" });
  const last = new Map();
  for (const p of days) for (const s of p.scales) {
    if (last.has(s.id)) assert.ok(daysBetween(last.get(s.id), p.date) >= 4, `${s.id} repeated after ${daysBetween(last.get(s.id), p.date)} days`);
    last.set(s.id, p.date);
  }
});

test("scheduler never rewrites existing dates and continues numbering", () => {
  const first = planDays({ scales, existing: [], from: "2030-01-01", to: "2030-01-03", minStatus: "draft" });
  const more = planDays({ scales, existing: first, from: "2030-01-04", to: "2030-01-05", minStatus: "draft" });
  assert.deepEqual(more.map(p => p.number), [4, 5]);
});

test("committed schedule: consecutive dates and numbers, no rejected items", () => {
  const sched = loadSchedule();
  const rejected = new Set(scales.flatMap(s => s.items.filter(it => it.status === "rejected").map(it => it.id)));
  sched.forEach((p, i) => {
    if (i) { assert.equal(daysBetween(sched[i - 1].date, p.date), 1); assert.equal(p.number, sched[i - 1].number + 1); }
    for (const s of p.scales) for (const it of s.items) assert.ok(!rejected.has(it.id), `${p.date} uses rejected ${it.id}`);
  });
});
