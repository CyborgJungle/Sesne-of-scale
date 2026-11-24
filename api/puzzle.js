// GET /api/puzzle?date=YYYY-MM-DD  → the puzzle for that calendar date.
// A date is only served once it has started somewhere on Earth (UTC+14), so future answers stay hidden.
import { getPuzzle } from "../lib/store.js";
import { send, query, isDate, withErrors } from "../lib/http.js";
import { latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  const { date } = query(req);
  if (!isDate(date)) return send(res, 400, { error: "date must be YYYY-MM-DD" });
  if (date > latestLiveDate()) return send(res, 404, { error: "not available yet" });
  const p = await getPuzzle(date);
  if (!p) return send(res, 404, { error: "no puzzle for this date" }, "public, s-maxage=60");
  // Published puzzles never change, so the CDN can hold them; browsers revalidate after 5 minutes.
  send(res, 200, p, "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400");
});
