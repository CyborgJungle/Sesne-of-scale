import { test } from "node:test";
import assert from "node:assert/strict";
import { toT, fromT, pointsFor, scorePuzzle, fmtVal, ticksFor, latestLiveDate, earliestLiveDate, addDays, shareText, band } from "../public/js/core.js";

const lin = { type: "lin", min: 0, max: 10 };
const log = { type: "log", min: 1, max: 10000, unit: "m" };

test("toT/fromT round-trip on linear and log scales", () => {
  for (const s of [lin, log]) for (const t of [0, 0.25, 0.5, 1]) assert.ok(Math.abs(toT(s, fromT(s, t)) - t) < 1e-12);
  assert.equal(toT(lin, 5), 0.5);
  assert.equal(toT(log, 100), 0.5);
});

test("scoring curve matches the documented points", () => {
  assert.equal(pointsFor(0), 100);
  assert.equal(pointsFor(0.1), 55);
  assert.equal(pointsFor(0.25), 22);
  assert.equal(band(70), "good"); assert.equal(band(69), "mid"); assert.equal(band(39), "bad");
});

test("scorePuzzle: perfect placements score 500 per scale, missing ones score 0", () => {
  const p = { number: 1, scales: [{ id: "a", ...lin, items: [1, 3, 5, 7, 9].map(v => ({ id: "a/" + v, value: v })) }] };
  const perfect = Object.fromEntries(p.scales[0].items.map(it => [it.id, toT(lin, it.value)]));
  assert.equal(scorePuzzle(p, perfect).total, 500);
  assert.equal(scorePuzzle(p, {}).total, 0);
  assert.equal(scorePuzzle(p, { ...perfect, "a/1": 2 }).perScale[0].items[0].pts, pointsFor(0.9)); // clamped to 1
});

test("formatting follows the scale's display spec", () => {
  assert.equal(fmtVal({ unit: "m" }, 8848.86), "8,849 m");
  assert.equal(fmtVal({ display: { prefix: "pH ", decimals: 1 } }, 7.35), "pH 7.4");
  assert.equal(fmtVal({ display: { kind: "year" } }, 1889.4), "1889");
  assert.equal(fmtVal({ display: { kind: "years" } }, 1 / 365), "24 hours");
  assert.equal(fmtVal({ unit: "SHU" }, 16000000), "16 million SHU");
});

test("ticks: log scales get one major tick per power of ten", () => {
  assert.deepEqual(ticksFor(log).majors.map(t => t.v), [1, 10, 100, 1000, 10000]);
  const lin2 = { type: "lin", min: -100, max: 3500, step: 500, tickStart: 0 };
  assert.deepEqual(ticksFor(lin2).majors.map(t => t.v), [0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
});

test("live date window spans UTC-12 to UTC+14", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  assert.equal(latestLiveDate(now), "2026-03-11");
  assert.equal(earliestLiveDate(now), "2026-03-10");
  assert.equal(earliestLiveDate(new Date("2026-03-10T11:00:00Z")), "2026-03-09");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
});

test("share card is spoiler-free: squares and scores only", () => {
  const p = { number: 7, scales: [{ id: "a", items: [] }, { id: "b", items: [] }] };
  const r = { total: 610, perScale: [{ score: 400, items: [95, 80, 75, 70, 80].map(pts => ({ pts })) }, { score: 210, items: [10, 50, 60, 40, 50].map(pts => ({ pts })) }] };
  assert.equal(shareText(p, r, "https://x.test"), "Sense of Scale #7  610/1000\n🟩🟩🟩🟩🟩  400\n🟥🟨🟨🟨🟨  210\nhttps://x.test");
});
