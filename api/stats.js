// GET /api/stats?date=YYYY-MM-DD&mode=easy|hard → { plays, mean, histogram: { bucket: count }, bucket }
// In production the histogram is rolled up by pg_cron every minute; the CDN caches it for 60s.
import { getStats, BUCKET } from "../lib/store.js";
import { send, query, isDate, withErrors } from "../lib/http.js";
import { latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  const { date, mode = "hard" } = query(req);
  if (!isDate(date) || date > latestLiveDate() || !["easy", "hard"].includes(mode)) return send(res, 400, { error: "bad request" });
  const s = await getStats(date, mode);
  send(res, 200, { ...s, mode, bucket: BUCKET }, "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
});
