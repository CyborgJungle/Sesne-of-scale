import { timingSafeEqual } from "node:crypto";

// Small helpers so the handlers run unchanged on Vercel and in scripts/dev.mjs.
export function send(res, status, data, cache = "no-store") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.end(JSON.stringify(data));
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

export async function readJson(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error("body too large"); }
  return raw ? JSON.parse(raw) : {};
}

export const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const isUuid = s => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function withErrors(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) { console.error(e); send(res, 500, { error: "server error" }); }
  };
}

/** Testers pass ?key=<TEST_KEY> to play any scheduled puzzle, including future ones. Disabled unless TEST_KEY is set. */
export function isTester(req) {
  const want = process.env.TEST_KEY || "";
  const got = new URL(req.url, "http://x").searchParams.get("key") || "";
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
