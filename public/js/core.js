// Pure game logic shared by the browser and the server (the API recomputes scores with it).
// No DOM access in this file.

export const ITEMS_PER_SCALE = 5;
export const MAX_PER_ITEM = 100;

/* ---------- Position on the scale (0 = bottom, 1 = top) ---------- */
export function toT(s, v) {
  if (s.type === "log") {
    const a = Math.log10(s.min), b = Math.log10(s.max);
    return (Math.log10(Math.max(v, s.min)) - a) / (b - a);
  }
  return (v - s.min) / (s.max - s.min);
}
export function fromT(s, t) {
  if (s.type === "log") {
    const a = Math.log10(s.min), b = Math.log10(s.max);
    return 10 ** (a + t * (b - a));
  }
  return s.min + t * (s.max - s.min);
}
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ---------- Scoring ---------- */
// 100 points for a perfect hit, ~55 at 10% of the scale away, ~22 at 25% away.
export const pointsFor = d => Math.round(MAX_PER_ITEM * Math.exp(-6 * d));
export const band = p => (p >= 70 ? "good" : p >= 40 ? "mid" : "bad");
export const verdict = p => (p >= 90 ? "Bullseye" : p >= 70 ? "Close" : p >= 40 ? "Ballpark" : "Way off");

export function scoreItem(scale, item, t) {
  if (typeof t !== "number" || !Number.isFinite(t)) return 0;
  return pointsFor(Math.abs(clamp(t, 0, 1) - clamp(toT(scale, item.value), 0, 1)));
}

/** placements: { [itemId]: t }. Returns { total, perScale: [{ id, score, items: [{id, pts}] }] } */
export function scorePuzzle(puzzle, placements) {
  const perScale = puzzle.scales.map(s => {
    const items = s.items.map(it => ({ id: it.id, pts: scoreItem(s, it, placements[it.id]) }));
    return { id: s.id, score: items.reduce((a, x) => a + x.pts, 0), items };
  });
  return { total: perScale.reduce((a, x) => a + x.score, 0), perScale };
}

/* ---------- Formatting ---------- */
export function round(v, d) { const p = 10 ** d; return String(Math.round(v * p) / p); }

export function fmtNum(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return trimZeros((v / 1e9).toPrecision(3)) + " billion";
  if (a >= 1e6) return trimZeros((v / 1e6).toPrecision(3)) + " million";
  if (a >= 1000) return Math.round(v).toLocaleString("en-US");
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return round(v, 1);
  if (a >= 1) return round(v, 2);
  if (a === 0) return "0";
  return String(Number(v.toPrecision(2)));
}
const trimZeros = s => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

export function fmtYears(y) {
  const d = y * 365;
  if (d < 1.5) { const h = Math.round(d * 24); return h + (h === 1 ? " hour" : " hours"); }
  if (d < 14) return Math.round(d) + " days";
  if (d < 70) return Math.round(d / 7) + " weeks";
  if (y < 1.5) return Math.round(y * 12) + " months";
  return fmtNum(y) + " years";
}

/** Display spec on a scale: { prefix?, suffix?, decimals?, kind?: "years" | "year" } */
export function fmtVal(s, v) {
  const d = s.display || {};
  if (d.kind === "years") return fmtYears(v);
  if (d.kind === "year") { const y = Math.round(v); return y < 0 ? `${-y} BCE` : String(y); }
  const num = d.decimals !== undefined ? round(v, d.decimals) : fmtNum(v);
  const suffix = d.suffix !== undefined ? d.suffix : s.unit ? " " + s.unit : "";
  return (d.prefix || "") + num + suffix;
}

export function tickText(s, v) {
  if (s.display && s.display.kind === "year") return fmtVal(s, v);
  const a = Math.abs(v);
  if (a >= 1e9) return v / 1e9 + "B";
  if (a >= 1e6) return v / 1e6 + "M";
  if (a >= 1e3 && (s.type === "log" || a >= 1e4)) return v / 1e3 + "k";
  return a >= 1000 ? v.toLocaleString("en-US") : String(Number(v.toPrecision(3)));
}

/** Major and minor tick values for a scale. */
export function ticksFor(s) {
  const majors = [], minors = [];
  if (s.ticks) s.ticks.forEach(tk => majors.push({ v: tk.v, l: tk.l }));
  else if (s.type === "log") {
    for (let e = Math.floor(Math.log10(s.min)); e <= Math.ceil(Math.log10(s.max)); e++) {
      const v = 10 ** e;
      if (v >= s.min * 0.999 && v <= s.max * 1.001) majors.push({ v, l: tickText(s, v) });
      for (let m = 2; m <= 9; m++) { const mv = m * v; if (mv > s.min && mv < s.max) minors.push(mv); }
    }
  } else {
    const step = s.step || niceStep(s.max - s.min);
    const anchor = s.tickStart !== undefined ? s.tickStart : 0;
    const start = anchor - Math.floor((anchor - s.min) / step) * step;
    for (let v = start; v <= s.max + 1e-9; v += step) {
      majors.push({ v, l: tickText(s, v) });
      const h = v + step / 2; if (h < s.max) minors.push(h);
    }
    if (start - step / 2 > s.min) minors.push(start - step / 2);
  }
  return { majors, minors };
}
function niceStep(range) {
  const raw = range / 7, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= raw);
}

/* ---------- Dates ---------- */
export const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const utcDate = d => d.toISOString().slice(0, 10);
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return utcDate(d);
}
export function daysBetween(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }
/** The latest calendar date anywhere on Earth right now (UTC+14). Puzzles up to this date may be served. */
export function latestLiveDate(now = new Date()) { return utcDate(new Date(now.getTime() + 14 * 3600e3)); }
/** The earliest calendar date anywhere on Earth right now (UTC-12). */
export function earliestLiveDate(now = new Date()) { return utcDate(new Date(now.getTime() - 12 * 3600e3)); }

/* ---------- Share card ---------- */
export const SQUARE = { good: "🟩", mid: "🟨", bad: "🟥" };
export function shareText(puzzle, result, url = "") {
  const max = puzzle.scales.length * ITEMS_PER_SCALE * MAX_PER_ITEM;
  const rows = result.perScale.map(r => r.items.map(i => SQUARE[band(i.pts)]).join("") + "  " + r.score);
  return [`Sense of Scale #${puzzle.number}  ${result.total}/${max}`, ...rows, url].filter(Boolean).join("\n");
}
