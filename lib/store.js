// Runtime data access. Uses Supabase (PostgREST) when SUPABASE_URL and a secret key are set,
// otherwise falls back to the schedule files in the repo and an in-memory results table (local dev).
import { loadSchedule } from "./schedule.js";

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const mode = SB_URL && SB_KEY ? "supabase" : "local";

export const BUCKET = 50;

/* ---------- Supabase REST ---------- */
export async function sb(path, { method = "GET", body, prefer } = {}) {
  const headers = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (SB_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${SB_KEY}`; // legacy JWT service_role key
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 || res.headers.get("content-length") === "0" ? null : res.json();
}

/* ---------- Local fallback ---------- */
let localPuzzles = null;
const localResults = new Map(); // date -> Map(playerId -> score)
function local() {
  if (!localPuzzles || process.env.NODE_ENV !== "production") localPuzzles = loadSchedule();
  return localPuzzles;
}

/* ---------- Puzzle cache (per warm function instance) ---------- */
const cache = new Map();

export async function getPuzzle(date) {
  if (cache.has(date)) return cache.get(date);
  let p;
  if (mode === "supabase") {
    const rows = await sb(`puzzles?date=eq.${date}&select=date,number,scales`);
    p = rows[0] || null;
  } else {
    p = local().find(x => x.date === date) || null;
  }
  if (p && mode === "supabase") cache.set(date, p);
  return p;
}

/** Dates and numbers of puzzles up to and including `lastDate`, newest first. */
export async function listPuzzles(lastDate) {
  if (mode === "supabase") return sb(`puzzles?date=lte.${lastDate}&select=date,number&order=date.desc&limit=1000`);
  return local().filter(p => p.date <= lastDate).map(({ date, number }) => ({ date, number })).reverse();
}

/** Returns true if stored, false if this player already has a result for that date. */
export async function saveResult({ date, playerId, placements, score, itemScores }) {
  if (mode === "supabase") {
    const rows = await sb("results?on_conflict=date,player_id", {
      method: "POST",
      body: { date, player_id: playerId, placements, score, item_scores: itemScores },
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    return rows.length > 0;
  }
  if (!localResults.has(date)) localResults.set(date, new Map());
  const m = localResults.get(date);
  if (m.has(playerId)) return false;
  m.set(playerId, score);
  return true;
}

export async function getStats(date) {
  if (mode === "supabase") {
    const rows = await sb(`daily_stats?date=eq.${date}&select=plays,mean,histogram,updated_at`);
    return rows[0] || { plays: 0, mean: null, histogram: {} };
  }
  const scores = [...(localResults.get(date)?.values() || [])];
  const histogram = {};
  for (const s of scores) { const b = Math.floor(s / BUCKET); histogram[b] = (histogram[b] || 0) + 1; }
  return { plays: scores.length, mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, histogram };
}
