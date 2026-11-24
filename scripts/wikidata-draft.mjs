#!/usr/bin/env node
// npm run wikidata -- <recipe> [--count 20]
//
// Drafts a scale from Wikidata: runs the recipe's SPARQL query, then picks well-known items spread evenly
// across the scale (one per band, preferring the item with the most Wikipedia language editions).
// Each item links to its Wikidata entity as the source. Items arrive as status "checked" (the value is
// taken directly from the source) and still need a person's approval in the review tool.
// If the scale file already exists, only new items are added; reviewed items are never touched.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCALES_DIR, slug } from "../lib/content.js";
import { toT } from "../public/js/core.js";

const UA = "SenseOfScale-content-draft/0.1";
const activeCountries = v => `${v} wdt:P31 wd:Q3624078 . FILTER NOT EXISTS { ${v} wdt:P576 [] }`;

export const RECIPES = {
  "country-area": {
    scale: { id: "country-area", field: "Geography", name: "Country size", question: "Land and water area in square kilometers. Each gridline step is ten times bigger.",
      unit: "km²", type: "log", min: 0.1, max: 30000000 },
    property: "P2046",
    sparql: `SELECT ?item ?itemLabel (MAX(?a) AS ?value) (MAX(?l) AS ?links) WHERE {
      ${activeCountries("?item")}
      ?item p:P2046/psv:P2046 ?v ; wikibase:sitelinks ?l .
      ?v wikibase:quantityAmount ?a ; wikibase:quantityUnit wd:Q712226 .  # square kilometre
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?item rdfs:label ?itemLabel. }
    } GROUP BY ?item ?itemLabel`,
    fact: (name, rank, total) => `${name} is the #${rank} largest of ${total} countries by area.`,
  },
  "capital-population": {
    scale: { id: "capital-population", field: "Geography", name: "Capital city population", question: "People living in the city itself (not the wider metro area). Each gridline step is ten times more.",
      unit: "people", type: "log", min: 100, max: 50000000 },
    property: "P1082",
    sparql: `SELECT ?item ?itemLabel ?countryLabel (MAX(?p) AS ?value) (MAX(?l) AS ?links) WHERE {
      ${activeCountries("?country")} ?country wdt:P36 ?item .
      ?item wdt:P1082 ?p ; wikibase:sitelinks ?l .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?item rdfs:label ?itemLabel. ?country rdfs:label ?countryLabel. }
    } GROUP BY ?item ?itemLabel ?countryLabel`,
    name: r => (r.itemLabel === r.countryLabel ? r.itemLabel : `${r.itemLabel} (${r.countryLabel})`),
    fact: (name, rank, total) => `${name.replace(/ \(.*\)$/, "")} is the #${rank} most populous of ${total} national capitals.`,
  },
};

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; }

async function query(sparql) {
  const res = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql), {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

/** Pick `count` items spread over the scale: split it into bands and take the best-known item in each. */
export function spreadPick(rows, scale, count) {
  const inRange = rows.filter(r => r.value >= scale.min && r.value <= scale.max);
  const bands = new Map();
  for (const r of inRange) {
    const b = Math.min(count - 1, Math.floor(toT(scale, r.value) * count));
    if (!bands.has(b) || bands.get(b).links < r.links) bands.set(b, r);
  }
  const picked = [...bands.values()];
  // Fill any empty bands with the next best-known items overall.
  for (const r of inRange.slice().sort((a, b) => b.links - a.links)) {
    if (picked.length >= count) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked.sort((a, b) => a.value - b.value);
}

const round = v => (v >= 100 ? Math.round(v) : Number(v.toPrecision(3)));

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  const recipe = RECIPES[name];
  if (!recipe) { console.error(`Usage: npm run wikidata -- <${Object.keys(RECIPES).join("|")}> [--count 20]`); process.exit(1); }
  const count = +arg("count", 20);
  const rows = (await query(recipe.sparql)).map(r => ({ ...r, value: +r.value, links: +r.links, qid: r.item.split("/").pop() }));
  const byValue = rows.slice().sort((a, b) => b.value - a.value);
  const famousCut = rows.map(r => r.links).sort((a, b) => b - a)[Math.floor(rows.length * 0.25)] || Infinity;
  const picked = spreadPick(rows, recipe.scale, count);

  const file = join(SCALES_DIR, `${recipe.scale.id}.json`);
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { ...recipe.scale, items: [] };
  const have = new Set(existing.items.map(it => slug(it.name)));
  let added = 0;
  for (const r of picked) {
    const nm = recipe.name ? recipe.name(r) : r.itemLabel;
    if (have.has(slug(nm)) || /^Q\d+$/.test(nm)) continue;
    existing.items.push({
      name: nm, value: round(r.value), source: `https://www.wikidata.org/wiki/${r.qid}`,
      quote: `Wikidata ${recipe.property} = ${r.value} ${recipe.scale.unit}`,
      fact: recipe.fact(nm, byValue.indexOf(r) + 1, rows.length),
      ...(r.links >= famousCut ? { familiar: true } : {}),
      status: "checked",
    });
    added++;
  }
  existing.items.sort((a, b) => a.value - b.value);
  writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
  console.log(`${recipe.scale.id}: ${rows.length} candidates, added ${added} items → ${file}`);
}
