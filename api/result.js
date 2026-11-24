// POST /api/result  { date, playerId, placements: { [itemId]: t } }
// The server recomputes the score from the stored puzzle, so a client can't submit a fake score.
import { getPuzzle, saveResult } from "../lib/store.js";
import { send, readJson, isDate, isUuid, withErrors } from "../lib/http.js";
import { scorePuzzle, earliestLiveDate, latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "invalid JSON" }); }
  const { date, playerId, placements } = body || {};
  if (!isDate(date) || !isUuid(playerId) || !placements || typeof placements !== "object") return send(res, 400, { error: "bad request" });
  // Only today's puzzle (in some time zone) counts toward the daily stats; archive plays don't.
  if (date < earliestLiveDate() || date > latestLiveDate()) return send(res, 409, { error: "not a live puzzle" });

  const puzzle = await getPuzzle(date);
  if (!puzzle) return send(res, 404, { error: "no puzzle for this date" });
  const ids = puzzle.scales.flatMap(s => s.items.map(i => i.id));
  const clean = {};
  for (const id of ids) {
    const t = placements[id];
    if (typeof t !== "number" || !(t >= 0 && t <= 1)) return send(res, 400, { error: `missing or invalid placement for ${id}` });
    clean[id] = Math.round(t * 1e4) / 1e4;
  }
  const result = scorePuzzle(puzzle, clean);
  const itemScores = Object.fromEntries(result.perScale.flatMap(s => s.items.map(i => [i.id, i.pts])));
  const stored = await saveResult({ date, playerId, placements: clean, score: result.total, itemScores });
  send(res, 200, { stored, score: result.total });
});
