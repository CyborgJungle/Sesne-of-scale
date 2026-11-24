# Sense of Scale

A daily game about how big, fast, hot, loud and old things really are. Every day everyone gets the same puzzle: **3 scales × 5 items**. Drag each item onto the gauge where you think it belongs, check, and score up to 100 points per item (1,500 a day). Share a spoiler-free result card and keep your streak going.

## How it fits together

```
 content/scales/*.json ──► npm run verify ──► review tool (/review) ──► npm run schedule ──► schedule/YYYY-MM.json
   (authored in git)        (auto source check)   (a person approves)      (3×5 per day)            │
                                                                                                    ▼ npm run sync
 Browser (static site on Vercel)                                                        Supabase Postgres
   GET  /api/puzzle?date=…  ── cached on the CDN, served only once that date has started somewhere on Earth
   POST /api/result         ── server recomputes the score; one row per player per day
   GET  /api/stats?date=…   ── score histogram, rolled up every minute by pg_cron, cached 60 s
   GET  /api/archive        ── past puzzles
```

- **No build step.** `public/` is plain HTML/CSS/ES modules, `api/` holds Vercel serverless functions, and there are no npm dependencies.
- **Why it handles a rush:** every player fetches the same puzzle, which the CDN caches, so 10,000 players means about one database read. The only write is one small insert per finished game.
- **Without Supabase** the API reads `schedule/*.json` and keeps results in memory. That's how local dev and the tests run, and production can work this way too until stats are needed.
- **Past puzzles never change.** Each scheduled day is a frozen snapshot of the exact items and values served.

## Run it locally

```bash
npm run dev          # http://localhost:3000  (review tool: http://localhost:3000/review)
npm test             # unit + API + content/scheduler tests
npm run test:e2e     # plays a full puzzle in Chromium (needs Playwright)
```

Node 20+ is required. In environments behind an HTTPS proxy, run the network scripts (`verify`, `wikidata`, `sync`) with `NODE_USE_ENV_PROXY=1`.

## Content pipeline

See [docs/CONTENT.md](docs/CONTENT.md) for the full guide. In short:

1. **Draft.** Add or extend `content/scales/<id>.json`, either by hand or with Claude using the prompt in `docs/CONTENT.md`, or from Wikidata with `npm run wikidata -- <recipe>`. Every item needs a source URL.
2. **Check automatically.** `npm run verify -- --write` fetches each Wikipedia source and confirms the number appears next to the item's name. Passing items become `checked` and get an evidence snippet. Problems are listed in `reports/source-check.md`.
3. **Review.** Open `/review` in the dev server and approve or reject each item (keys A/R/E/J/K). Only `verified` items can be scheduled.
4. **Validate.** `npm run validate` checks schema and puzzle-quality rules. CI runs it on every push.
5. **Schedule.** `npm run schedule` adds days up to 60 ahead. It never changes days already scheduled. Rules: scales rotate least-recently-used first, an item avoids repeating within 90 days, the three scales come from different fields, and the five items spread across the scale.
6. **Publish.** `npm run sync` upserts content and future puzzles to Supabase.

**Item status:** `draft` → `checked` (source auto-verified) → `verified` (a person approved) → schedulable. `rejected` items are kept, with a note, so nobody re-adds them.

## Deploy

1. **Supabase.** Create a project and run `supabase/migrations/20261124000000_init.sql` (SQL editor, or `supabase db push`). Enable `pg_cron` under Database → Extensions if the last line fails. All tables have RLS on and no public policies. Only the server's secret key can reach them.
2. **Vercel.** Import this repo with framework preset "Other". `vercel.json` already sets `public/` as output and bundles `schedule/` with the functions. Add the env vars `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-side only).
3. **Data.** Copy `.env.example` to `.env`, fill it in, then run `npm run sync`.
4. Note that Vercel's Hobby plan is for non-commercial use only. Use Pro if the site will carry ads or make money.

**Keep this repository private.** `schedule/` contains future answers.

## Project layout

| Path | What |
|---|---|
| `public/` | The game: `index.html`, `style.css`, `js/app.js` (UI), `js/core.js` (scale maths, scoring, formatting; shared with the server) |
| `api/` | `puzzle`, `result`, `stats`, `archive` serverless functions |
| `lib/` | Content loading/validation, schedule files, data store (Supabase REST or local fallback) |
| `scripts/` | `dev`, `validate`, `verify-sources`, `wikidata-draft`, `schedule`, `sync` |
| `content/scales/` | One JSON file per scale: the source of truth for content |
| `schedule/` | Published puzzles, one file per month |
| `supabase/migrations/` | Database schema, RLS, stats rollup, item-difficulty view |
| `tools/review.html` | Content review UI (dev server only, never deployed) |
| `test/` | `node --test` suites; `test/e2e/` drives a real browser |
