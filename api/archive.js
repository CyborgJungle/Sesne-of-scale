// GET /api/archive?before=YYYY-MM-DD → [{ date, number }] of puzzles before the player's local today, newest first.
// Testers with ?key=<TEST_KEY>&all=1 get every scheduled puzzle, oldest first (never cached).
import { listPuzzles } from "../lib/store.js";
import { send, query, isDate, isTester, withErrors } from "../lib/http.js";
import { addDays, latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  const { before, all } = query(req);
  if (all && isTester(req)) return send(res, 200, (await listPuzzles("9999-12-31")).reverse(), "private, no-store");
  const cap = addDays(latestLiveDate(), -1);
  const last = isDate(before) && addDays(before, -1) < cap ? addDays(before, -1) : cap;
  send(res, 200, await listPuzzles(last), "public, max-age=300, s-maxage=3600");
});
