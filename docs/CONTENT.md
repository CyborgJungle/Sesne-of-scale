# Content guide

## How much content a year needs

A day is 3 scales × 5 items, so a year is **1,095 scale appearances and 5,475 item slots**. The scheduler rotates scales least-recently-used first and keeps an item away for 90 days. For each scale to come back only every couple of months, with mostly fresh items, you need roughly:

- **~200 scales × ~20 items** (about 4,000 sourced facts). Each scale then appears about 5 times a year with mostly different items.
- You don't need a whole year before launch. Keep at least 30 scheduled days in the buffer and add about 20 scales a week.

**In this repo so far:** 30 scales and about 525 items. That covers serious ones (melting points, earthquakes, rivers) and wacky ones: insect sting pain, sweeteners, voltage, radiation doses, viscosity, Beaufort wind descriptions, data sizes, caffeine, everyday temperatures. That's about 5 weeks of puzzles before items start repeating, enough for a soft launch.

**Easy mode and ties:** Easy mode only asks for the order, so items with equal values (for example several insects at pain level 2) are interchangeable, and either spot counts. The scheduler still avoids putting items that are too close together in the same puzzle.

## Scale file format

`content/scales/<id>.json` (the file name must match `id`):

```jsonc
{
  "id": "ocean-depth",                 // stable, lowercase-with-dashes
  "field": "Oceanography",             // category; the 3 scales of a day come from different fields
  "name": "How deep down",             // title shown to players
  "question": "Meters below the water surface. Each gridline step is ten times deeper.",
  "unit": "m",                         // shown after values; "" for none
  "type": "log",                       // "lin" or "log" (log needs min > 0)
  "min": 10, "max": 12000,
  "step": 500, "tickStart": 0,         // optional, linear only: major tick spacing and alignment
  "ticks": [{ "v": 1, "l": "1 yr" }],  // optional: custom ticks
  "display": { "prefix": "pH ", "decimals": 1, "suffix": "", "kind": "years | year" },  // optional
  "items": [
    {
      "name": "Titanic wreck",
      "value": 3800,
      "source": "https://en.wikipedia.org/wiki/Wreck_of_the_Titanic",
      "fact": "The Titanic's wreck was found in 1985, 73 years after it sank.",   // shown after the reveal
      "familiar": true,               // an anchor most players know
      "disputed": false,              // sources disagree; reviewer should double-check
      "verify": { "number": 3800, "match": "Titanic" },   // optional hints for the source checker
      "status": "draft",              // draft → checked → verified (or rejected)
      "quote": "…evidence snippet…",  // filled in by `npm run verify -- --write`
      "key": "titanic"                // optional: fixes the item id if you rename it later
    }
  ]
}
```

An item's id is `<scale id>/<slug of name>`. Results and analytics refer to it, so rename items before they're scheduled, or set `key`.

## What makes a good scale

- **Surprise beats trivia.** The fun is "wait, *that* is hotter than *that*?" Mix things players know (mark 2–4 as `familiar`) with a few surprises.
- **Spread.** Items should cover the whole range, with at least 5% of the scale between neighbours. The validator warns when a third of the scale is empty.
- **Log or linear:** use `log` when values span more than about 2 orders of magnitude, and say so in the question ("each gridline step is ten times…").
- **One clear number per item.** If sources give a range, use a sensible middle and keep the range in `verify.number` (for example the low end, as the page writes it), or mark the item `disputed`.
- **Facts must be true too.** Reviewers approve the fun fact along with the value. Keep it to one sentence that can be checked against the source page.
- **Avoid** politically contested claims, tragedies used as punchlines, and figures that change monthly (prices, follower counts).

## Drafting with Claude

Paste this prompt into Claude and save the JSON it returns as `content/scales/<id>.json`:

> Draft a scale for a daily guessing game where players place 5 items on a vertical gauge.
> Topic: **<topic>**. Return only JSON in the format below, with 20 items.
> Rules: every value must come from the English Wikipedia page given in `source`, written the way that page writes it
> (if the page gives a range, use a middle value and put the low end in `verify.number`). Spread the items over the
> whole range; include 3 familiar anchors (`"familiar": true`) and a few surprising ones. Each item gets a one-sentence
> fun fact that the same page supports. Set `"status": "draft"`. Choose `type` "log" if values span more than two
> orders of magnitude. <paste the format block from docs/CONTENT.md>

Then run `npm run validate` and `npm run verify -- <id> --write`, and review in `/review`.

## Drafting from Wikidata

`npm run wikidata -- country-area` (or `capital-population`) runs a SPARQL query, then picks one well-known item per band of the scale (by number of Wikipedia language editions). To add a recipe, add an entry to `RECIPES` in `scripts/wikidata-draft.mjs`: a scale definition, a property and a query that returns `?item ?itemLabel ?value ?links`. Good next candidates: mountain elevation (P2044), building height (P2048), founding year (P571), bridge span (P2787), city population, lake area, animal mass (P2067).

## Reviewing

`npm run dev`, then open http://localhost:3000/review. Items with an evidence snippet come first. Check that the snippet supports both the value and the fact, then approve (A), reject with a reason (R), or fix the value and source (E). Commit the changed JSON files afterwards.

## After launch

`item_difficulty` in Supabase shows the average points per item from real players. Use it to retire items that are too easy (average above 90) or impossible (below 15), and to balance days, for example easier on Mondays.
