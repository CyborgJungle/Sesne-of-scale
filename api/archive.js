// GET /api/archive?before=YYYY-MM-DD → [{ date, number }] of puzzles before the player's local today, newest first.
import { listPuzzles } from "../lib/store.js";
import { send, query, isDate, withErrors } from "../lib/http.js";
import { addDays, latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  const { before } = query(req);
  const cap = addDays(latestLiveDate(), -1);
  const last = isDate(before) && addDays(before, -1) < cap ? addDays(before, -1) : cap;
  send(res, 200, await listPuzzles(last), "public, max-age=300, s-maxage=3600");
});
