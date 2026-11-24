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

test("easy mode: exact spot 100, one off 50, further 0; ties are interchangeable", async () => {
  const { scoreOrder, scoreOrders, trueOrder } = await import("../public/js/core.js");
  const s = { id: "x", items: [["a", 5], ["b", 4], ["c", 3], ["d", 2], ["e", 1]].map(([id, value]) => ({ id, value })) };
  assert.deepEqual(trueOrder(s), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(scoreOrder(s, ["a", "b", "c", "d", "e"]).map(x => x.pts), [100, 100, 100, 100, 100]);
  assert.deepEqual(scoreOrder(s, ["b", "a", "c", "d", "e"]).map(x => x.pts), [50, 50, 100, 100, 100]);
  assert.deepEqual(scoreOrder(s, ["e", "b", "c", "d", "a"]).map(x => x.pts), [0, 100, 100, 100, 0]);
  const tie = { id: "t", items: [["a", 2], ["b", 2], ["c", 1], ["d", 1], ["e", 0]].map(([id, value]) => ({ id, value })) };
  assert.deepEqual(scoreOrder(tie, ["b", "a", "d", "c", "e"]).map(x => x.pts), [100, 100, 100, 100, 100]);
  const p = { scales: [s] };
  assert.equal(scoreOrders(p, { x: ["a", "b", "c", "d", "e"] }).total, 500);
  assert.equal(scoreOrders(p, {}).total, 0);
});

test("SI, byte and mass formatting", async () => {
  const { fmtVal } = await import("../public/js/core.js");
  assert.equal(fmtVal({ unit: "V", display: { kind: "si" } }, 0.075), "75 mV");
  assert.equal(fmtVal({ unit: "V", display: { kind: "si" } }, 25500000), "25.5 MV");
  assert.equal(fmtVal({ unit: "Sv", display: { kind: "si" } }, 9.8e-8), "98 nSv");
  assert.equal(fmtVal({ display: { kind: "bytes" } }, 4.7e9), "4.7 GB");
  assert.equal(fmtVal({ display: { kind: "mass" } }, 0.0025), "2.5 g");
  assert.equal(fmtVal({ display: { kind: "mass" } }, 180000), "180 tonnes");
});

test("very large and very small numbers use powers of ten", async () => {
  const { fmtNum, tickText } = await import("../public/js/core.js");
  assert.equal(fmtNum(2.3e14), "230 trillion");
  assert.equal(fmtNum(2.3e17), "2.3×10¹⁷");
  assert.equal(fmtNum(0.00005), "5×10⁻⁵");
  assert.equal(tickText({ type: "log" }, 1e15), "10¹⁵");
  assert.equal(tickText({ type: "log" }, 1e12), "1T");
});
