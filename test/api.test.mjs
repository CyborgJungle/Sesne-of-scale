// Runs the API handlers in local mode (no Supabase) against a fake request/response.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import puzzle from "../api/puzzle.js";
import result from "../api/result.js";
import stats from "../api/stats.js";
import archive from "../api/archive.js";
import { loadSchedule } from "../lib/schedule.js";
import { toT, addDays, earliestLiveDate, latestLiveDate } from "../public/js/core.js";

async function call(handler, { url, method = "GET", body } = {}) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { url, method, headers: {} });
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await handler(req, res);
  return { status: res.statusCode, cache: res.headers["cache-control"], json: res.body ? JSON.parse(res.body) : null };
}

const live = loadSchedule().filter(p => p.date >= earliestLiveDate() && p.date <= latestLiveDate());
const today = live[0];

test("puzzle: rejects bad dates and hides future puzzles", async () => {
  assert.equal((await call(puzzle, { url: "/api/puzzle?date=nope" })).status, 400);
  const future = await call(puzzle, { url: `/api/puzzle?date=${addDays(latestLiveDate(), 1)}` });
  assert.equal(future.status, 404);
  assert.equal(future.cache, "no-store", "a not-yet-live date must not be cached");
});

test("puzzle: serves a live puzzle with CDN caching", { skip: !today && "no live puzzle in schedule/" }, async () => {
  const r = await call(puzzle, { url: `/api/puzzle?date=${today.date}` });
  assert.equal(r.status, 200);
  assert.equal(r.json.number, today.number);
  assert.match(r.cache, /s-maxage=\d+/);
});

test("result: server recomputes the score; one result per player per day", { skip: !today && "no live puzzle" }, async () => {
  const placements = {};
  for (const s of today.scales) for (const it of s.items) placements[it.id] = toT(s, it.value);
  const playerId = randomUUID();
  const r1 = await call(result, { url: "/api/result", method: "POST", body: { date: today.date, playerId, placements } });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.score, today.scales.length * 500);
  assert.equal(r1.json.stored, true);
  const r2 = await call(result, { url: "/api/result", method: "POST", body: { date: today.date, playerId, placements } });
  assert.equal(r2.json.stored, false);

  const missing = await call(result, { url: "/api/result", method: "POST", body: { date: today.date, playerId: randomUUID(), placements: {} } });
  assert.equal(missing.status, 400);

  const st = await call(stats, { url: `/api/stats?date=${today.date}` });
  assert.equal(st.json.plays, 1);
  assert.equal(st.json.histogram[String(Math.floor(r1.json.score / 50))], 1);
});

test("result: easy mode scores the order; a player still gets one result per day", { skip: !today && "no live puzzle" }, async () => {
  const { trueOrder } = await import("../public/js/core.js");
  const orders = Object.fromEntries(today.scales.map(s => [s.id, trueOrder(s)]));
  const playerId = randomUUID();
  const r = await call(result, { url: "/api/result", method: "POST", body: { date: today.date, playerId, mode: "easy", orders } });
  assert.equal(r.status, 200);
  assert.equal(r.json.score, today.scales.length * 500);
  assert.equal(r.json.mode, "easy");
  const again = await call(result, { url: "/api/result", method: "POST", body: { date: today.date, playerId, mode: "easy", orders } });
  assert.equal(again.json.stored, false);
  const bad = { ...orders, [today.scales[0].id]: orders[today.scales[0].id].slice(0, 4) };
  assert.equal((await call(result, { url: "/api/result", method: "POST", body: { date: today.date, playerId: randomUUID(), mode: "easy", orders: bad } })).status, 400);
  const st = await call(stats, { url: `/api/stats?date=${today.date}&mode=easy` });
  assert.equal(st.json.plays, 1);
});

test("result: archive dates don't count", async () => {
  const old = loadSchedule().find(p => p.date < addDays(earliestLiveDate(), -1));
  const r = await call(result, { url: "/api/result", method: "POST", body: { date: old?.date || "2000-01-01", playerId: randomUUID(), placements: {} } });
  assert.equal(r.status, 409);
});

test("archive: lists only dates before the player's today", async () => {
  const r = await call(archive, { url: `/api/archive?before=${today?.date || latestLiveDate()}` });
  assert.equal(r.status, 200);
  assert.ok(r.json.every(p => p.date < (today?.date || latestLiveDate())));
});

test("test key: unlocks future puzzles and the full list, uncached; wrong or missing key doesn't", async () => {
  const future = loadSchedule().find(p => p.date > latestLiveDate());
  if (!future) return;
  process.env.TEST_KEY = "k".repeat(24);
  try {
    assert.equal((await call(puzzle, { url: `/api/puzzle?date=${future.date}` })).status, 404);
    assert.equal((await call(puzzle, { url: `/api/puzzle?date=${future.date}&key=${"x".repeat(24)}` })).status, 404);
    const ok = await call(puzzle, { url: `/api/puzzle?date=${future.date}&key=${"k".repeat(24)}` });
    assert.equal(ok.status, 200);
    assert.equal(ok.cache, "private, no-store");
    const list = await call(archive, { url: `/api/archive?all=1&key=${"k".repeat(24)}` });
    assert.equal(list.json.length, loadSchedule().length);
    const noKey = await call(archive, { url: `/api/archive?all=1` });
    assert.ok(noKey.json.every(p => p.date <= latestLiveDate()));
  } finally { delete process.env.TEST_KEY; }
});
