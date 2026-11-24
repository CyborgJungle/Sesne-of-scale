// Loads and validates the authored content in content/scales/*.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toT } from "../public/js/core.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCALES_DIR = join(ROOT, "content", "scales");
export const STATUSES = ["draft", "checked", "verified", "rejected"];
const RANK = { rejected: -1, draft: 0, checked: 1, verified: 2 };
export const statusAtLeast = (s, min) => (RANK[s] ?? -1) >= RANK[min];

export const slug = s => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function loadScales(dir = SCALES_DIR) {
  return readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => {
    const file = join(dir, f);
    const s = JSON.parse(readFileSync(file, "utf8"));
    s._file = file;
    for (const it of s.items || []) it.id = `${s.id}/${it.key || slug(it.name)}`;
    return s;
  });
}

export function saveScale(s) {
  const { _file, ...rest } = s;
  const clean = { ...rest, items: rest.items.map(({ id, ...it }) => it) };
  writeFileSync(_file, JSON.stringify(clean, null, 2) + "\n");
}

/** The public subset of a scale that goes into a puzzle snapshot. */
export function scaleSnapshot(s, items) {
  const out = { id: s.id, field: s.field, name: s.name, question: s.question, unit: s.unit || "", type: s.type, min: s.min, max: s.max };
  for (const k of ["step", "tickStart", "ticks", "display"]) if (s[k] !== undefined) out[k] = s[k];
  out.items = items.map(it => ({ id: it.id, name: it.name, value: it.value, fact: it.fact || "", source: it.source }));
  return out;
}

/* ---------- Validation ---------- */
const MIN_ITEMS = 10, TARGET_ITEMS = 20;

export function validateScale(s) {
  const errors = [], warnings = [];
  const req = ["id", "field", "name", "question", "type", "min", "max", "items"];
  for (const k of req) if (s[k] === undefined || s[k] === "") errors.push(`missing "${k}"`);
  if (s.id && s._file && !s._file.endsWith(`/${s.id}.json`)) errors.push(`file name must be ${s.id}.json`);
  if (!["lin", "log"].includes(s.type)) errors.push(`type must be "lin" or "log"`);
  if (!(s.min < s.max)) errors.push("min must be below max");
  if (s.type === "log" && !(s.min > 0)) errors.push("log scales need min > 0");
  if (s.ticks && !Array.isArray(s.ticks)) errors.push("ticks must be an array of {v, l}");
  if (!Array.isArray(s.items)) return { errors, warnings };

  const ids = new Set();
  for (const it of s.items) {
    const where = `item "${it.name}"`;
    if (!it.name) errors.push("item without a name");
    if (typeof it.value !== "number" || !Number.isFinite(it.value)) errors.push(`${where}: value must be a number`);
    else if (it.value < s.min || it.value > s.max) errors.push(`${where}: value ${it.value} is outside ${s.min}–${s.max}`);
    if (!/^https?:\/\//.test(it.source || "")) errors.push(`${where}: needs a source URL`);
    if (!STATUSES.includes(it.status || "draft")) errors.push(`${where}: unknown status "${it.status}"`);
    if (!it.fact) warnings.push(`${where}: no fun fact`);
    if (ids.has(it.id)) errors.push(`${where}: duplicate id ${it.id}`);
    ids.add(it.id);
  }
  const live = s.items.filter(it => it.status !== "rejected");
  if (live.length < MIN_ITEMS) warnings.push(`only ${live.length} usable items (minimum ${MIN_ITEMS}, target ${TARGET_ITEMS})`);
  else if (live.length < TARGET_ITEMS) warnings.push(`${live.length} usable items (target ${TARGET_ITEMS})`);
  if (!live.some(it => it.familiar)) warnings.push("no item is marked familiar (an anchor players know)");

  if (!errors.length) {
    const ts = live.map(it => toT(s, it.value)).sort((a, b) => a - b);
    if (ts.length && ts[ts.length - 1] - ts[0] < 0.5) warnings.push(`items only span ${Math.round((ts[ts.length - 1] - ts[0]) * 100)}% of the scale`);
    const thirds = [0, 0, 0]; ts.forEach(t => thirds[Math.min(2, Math.floor(t * 3))]++);
    if (thirds.some(n => n === 0)) warnings.push(`a third of the scale has no items (bottom/middle/top: ${thirds.join("/")})`);
  }
  return { errors, warnings };
}
