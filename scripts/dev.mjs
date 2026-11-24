#!/usr/bin/env node
// npm run dev — serves public/ and the /api functions locally, like Vercel does.
// Also serves the content review tool at /review (dev only, never deployed).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { ROOT, loadScales, saveScale, STATUSES } from "../lib/content.js";
import { readJson, send } from "../lib/http.js";

const PORT = +process.env.PORT || 3000;
const PUBLIC = join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };

async function serveFile(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (pathname.startsWith("/api/")) {
      const name = pathname.slice(5).replace(/[^a-z-]/g, "");
      const mod = await import(join(ROOT, "api", `${name}.js`)).catch(() => null);
      if (!mod) return send(res, 404, { error: "no such endpoint" });
      return await mod.default(req, res);
    }
    if (pathname === "/review") return serveFile(res, join(ROOT, "tools", "review.html"));
    if (pathname === "/dev/content") return send(res, 200, loadScales().map(({ _file, ...s }) => s));
    if (pathname === "/dev/review" && req.method === "POST") {
      const { id, status, value, source, note } = await readJson(req);
      if (!STATUSES.includes(status)) return send(res, 400, { error: "bad status" });
      const scale = loadScales().find(s => s.items.some(it => it.id === id));
      if (!scale) return send(res, 404, { error: "unknown item" });
      const it = scale.items.find(x => x.id === id);
      it.status = status;
      if (typeof value === "number") it.value = value;
      if (typeof source === "string" && source) it.source = source;
      if (note) it.note = note; else delete it.note;
      saveScale(scale);
      return send(res, 200, { ok: true });
    }
    const file = normalize(join(PUBLIC, pathname === "/" ? "index.html" : pathname));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return serveFile(res, extname(file) ? file : file + ".html");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, () => console.log(`Sense of Scale dev server: http://localhost:${PORT}  (review tool: /review)`));
