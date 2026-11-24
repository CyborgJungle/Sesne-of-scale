// POST /api/result
//   Hard: { date, playerId, mode: "hard", placements: { [itemId]: t } }
//   Easy: { date, playerId, mode: "easy", orders: { [scaleId]: [itemId, ...] } }   (most → least)
// The server recomputes the score from the stored puzzle, so a client can't submit a fake score.
// One result per player per day, whichever mode they chose.
import { getPuzzle, saveResult } from "../lib/store.js";
import { send, readJson, isDate, isUuid, withErrors } from "../lib/http.js";
import { scorePuzzle, scoreOrders, earliestLiveDate, latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "invalid JSON" }); }
  const { date, playerId } = body || {};
  const mode = body?.mode === "easy" ? "easy" : "hard";
  if (!isDate(date) || !isUuid(playerId)) return send(res, 400, { error: "bad request" });
  // Only today's puzzle (in some time zone) counts toward the daily stats; archive plays don't.
  if (date < earliestLiveDate() || date > latestLiveDate()) return send(res, 409, { error: "not a live puzzle" });

  const puzzle = await getPuzzle(date);
  if (!puzzle) return send(res, 404, { error: "no puzzle for this date" });

  let answer, result;
  if (mode === "hard") {
    const placements = body.placements;
    if (!placements || typeof placements !== "object") return send(res, 400, { error: "placements required" });
    answer = {};
    for (const s of puzzle.scales) for (const { id } of s.items) {
      const t = placements[id];
      if (typeof t !== "number" || !(t >= 0 && t <= 1)) return send(res, 400, { error: `missing or invalid placement for ${id}` });
      answer[id] = Math.round(t * 1e4) / 1e4;
    }
    result = scorePuzzle(puzzle, answer);
  } else {
    const orders = body.orders;
    if (!orders || typeof orders !== "object") return send(res, 400, { error: "orders required" });
    answer = {};
    for (const s of puzzle.scales) {
      const o = orders[s.id], ids = s.items.map(it => it.id);
      if (!Array.isArray(o) || o.length !== ids.length || new Set(o).size !== ids.length || !o.every(id => ids.includes(id)))
        return send(res, 400, { error: `order for ${s.id} must list each of its items once` });
      answer[s.id] = o;
    }
    result = scoreOrders(puzzle, answer);
  }

  const itemScores = Object.fromEntries(result.perScale.flatMap(s => s.items.map(i => [i.id, i.pts])));
  const stored = await saveResult({ date, playerId, mode, answer, score: result.total, itemScores });
  send(res, 200, { stored, score: result.total, mode });
});
