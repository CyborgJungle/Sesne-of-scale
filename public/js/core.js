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

/** Hard mode. placements: { [itemId]: t }. Returns { total, perScale: [{ id, score, items: [{id, pts}] }] } */
export function scorePuzzle(puzzle, placements) {
  const perScale = puzzle.scales.map(s => {
    const items = s.items.map(it => ({ id: it.id, pts: scoreItem(s, it, placements[it.id]) }));
    return { id: s.id, score: items.reduce((a, x) => a + x.pts, 0), items };
  });
  return { total: perScale.reduce((a, x) => a + x.score, 0), perScale };
}

/* ---------- Easy mode: put the five items in order (most at the top) ---------- */
export const MODES = ["easy", "hard"];
export const EASY_POINTS = [100, 50, 0];   // exact spot, one off, further off

/** Item ids from most to least. */
export const trueOrder = s => s.items.slice().sort((a, b) => b.value - a.value).map(it => it.id);

/** order: item ids top (most) → bottom (least). Returns [{ id, pts, rank, should }] in the player's order.
 *  Items with equal values are interchangeable: any of their shared spots counts as right. */
export function scoreOrder(s, order) {
  const value = new Map(s.items.map(it => [it.id, it.value]));
  return (order || []).map((id, rank) => {
    if (!value.has(id)) return { id, rank, should: -1, pts: 0 };
    const v = value.get(id);
    const lo = s.items.filter(it => it.value > v).length;               // first spot it may take
    const hi = lo + s.items.filter(it => it.value === v).length - 1;     // last spot it may take
    const off = rank < lo ? lo - rank : rank > hi ? rank - hi : 0;
    return { id, rank, should: rank < lo ? lo : rank > hi ? hi : rank, pts: EASY_POINTS[Math.min(off, 2)] };
  });
}

/** Easy mode. orders: { [scaleId]: [itemId, ...] }. Same result shape as scorePuzzle. */
export function scoreOrders(puzzle, orders) {
  const perScale = puzzle.scales.map(s => {
    const scored = new Map(scoreOrder(s, orders[s.id]).map(x => [x.id, x.pts]));
    const items = s.items.map(it => ({ id: it.id, pts: scored.get(it.id) || 0 }));
    return { id: s.id, score: items.reduce((a, x) => a + x.pts, 0), items };
  });
  return { total: perScale.reduce((a, x) => a + x.score, 0), perScale };
}

/** Score a saved game of either mode: { mode, placements, orders }. */
export const scoreGame = (puzzle, g) => (g.mode === "easy" ? scoreOrders(puzzle, g.orders || {}) : scorePuzzle(puzzle, g.placements || {}));

/* ---------- Formatting ---------- */
export function round(v, d) { const p = 10 ** d; return String(Math.round(v * p) / p); }

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = n => String(n).split("").map(c => (c === "-" ? "⁻" : SUP[+c])).join("");
/** 2.3e14 → "2.3×10¹⁴" */
export const sci = v => { const e = Math.floor(Math.log10(Math.abs(v))); const m = trimZeros((v / 10 ** e).toPrecision(2)); return (m === "1" ? "" : m + "×") + "10" + sup(e); };

export function fmtNum(v) {
  const a = Math.abs(v);
  if (a >= 1e15 || (a > 0 && a < 1e-4)) return sci(v);
  if (a >= 1e12) return trimZeros((v / 1e12).toPrecision(3)) + " trillion";
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

const SI = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"]];
/** 0.075 V → "75 mV", 25500000 V → "25.5 MV". */
export function fmtSI(v, unit) {
  const a = Math.abs(v);
  const [f, p] = SI.find(([f]) => a >= f * 0.9995) || SI[SI.length - 1];
  return fmtNum(v / f) + " " + p + unit;
}
/** Decimal byte units: 4700000000 → "4.7 GB". */
export function fmtBytes(v) {
  const units = ["B", "kB", "MB", "GB", "TB", "PB", "EB"];
  let i = 0;
  while (Math.abs(v) >= 999.5 && i < units.length - 1) { v /= 1000; i++; }
  return fmtNum(v) + " " + units[i];
}
/** Kilograms → mg / g / kg / tonnes. */
export function fmtMass(kg) {
  const a = Math.abs(kg);
  if (a >= 1000) return fmtNum(kg / 1000) + (a >= 1999.5 ? " tonnes" : " tonne");
  if (a >= 1) return fmtNum(kg) + " kg";
  if (a >= 0.001) return fmtNum(kg * 1000) + " g";
  return fmtNum(kg * 1e6) + " mg";
}

/** Display spec on a scale: { prefix?, suffix?, decimals?, kind?: "years" | "year" | "si" | "bytes" | "mass" } */
export function fmtVal(s, v) {
  const d = s.display || {};
  if (d.kind === "years") return fmtYears(v);
  if (d.kind === "si") return fmtSI(v, s.unit || "");
  if (d.kind === "bytes") return fmtBytes(v);
  if (d.kind === "mass") return fmtMass(v);
  if (d.kind === "year") { const y = Math.round(v); return y < 0 ? `${-y} BCE` : String(y); }
  const num = d.decimals !== undefined ? round(v, d.decimals) : fmtNum(v);
  const suffix = d.suffix !== undefined ? d.suffix : s.unit ? " " + s.unit : "";
  return (d.prefix || "") + num + suffix;
}

export function tickText(s, v) {
  if (s.display && ["year", "si", "bytes", "mass"].includes(s.display.kind)) return fmtVal(s, v);
  const a = Math.abs(v);
  if (a >= 1e15 || (a > 0 && a < 1e-4)) return sci(v);
  if (a >= 1e12) return v / 1e12 + "T";
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
export function shareText(puzzle, result, url = "", mode = "hard") {
  const max = puzzle.scales.length * ITEMS_PER_SCALE * MAX_PER_ITEM;
  const rows = result.perScale.map(r => r.items.map(i => SQUARE[band(i.pts)]).join("") + "  " + r.score);
  const tag = mode === "easy" ? " (Easy)" : "";
  return [`Sense of Scale #${puzzle.number}${tag}  ${result.total}/${max}`, ...rows, url].filter(Boolean).join("\n");
}
