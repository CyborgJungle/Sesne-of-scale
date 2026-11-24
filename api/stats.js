// GET /api/stats?date=YYYY-MM-DD → { plays, mean, histogram: { bucket: count }, bucket }
// In production the histogram is rolled up by pg_cron every minute; the CDN caches it for 60s.
import { getStats, BUCKET } from "../lib/store.js";
import { send, query, isDate, withErrors } from "../lib/http.js";
import { latestLiveDate } from "../public/js/core.js";

export default withErrors(async (req, res) => {
  const { date } = query(req);
  if (!isDate(date) || date > latestLiveDate()) return send(res, 400, { error: "bad date" });
  const s = await getStats(date);
  send(res, 200, { ...s, bucket: BUCKET }, "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
});
