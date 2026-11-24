import {
  toT, fromT, clamp, scoreItem, band, verdict, fmtVal, ticksFor, isoDate, addDays, daysBetween,
  shareText, scorePuzzle, ITEMS_PER_SCALE, MAX_PER_ITEM,
} from "./core.js";

/* ---------- Constants & helpers ---------- */
const PAD_T = 26, PAD_B = 26, AXIS_X = 66, LBL_X = AXIS_X + 64;
const main = document.getElementById("main");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const color = p => `var(--${band(p)})`;
const fmtDate = iso => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const n = v => Number(v).toLocaleString("en-US");

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play still works */ } },
};
function playerId() {
  let id = store.get("sos:player");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    store.set("sos:player", id);
  }
  return id;
}
const KEY = { daily: "sos:daily", archive: "sos:archive" };
const games = mode => store.get(KEY[mode], {});
function saveGame() {
  const all = games(S.mode); all[S.puzzle.date] = S.g; store.set(KEY[S.mode], all);
}
const newGame = () => ({ placements: {}, k: 0, revealed: false, done: false, perScale: [], total: 0, submitted: false });

/** Personal stats from finished daily games. */
function myStats(today) {
  const done = Object.entries(games("daily")).filter(([, g]) => g.done).sort(([a], [b]) => a.localeCompare(b));
  const dates = new Set(done.map(([d]) => d));
  let streak = 0;
  for (let d = dates.has(today) ? today : addDays(today, -1); dates.has(d); d = addDays(d, -1)) streak++;
  let maxStreak = 0, run = 0, prev = null;
  for (const [d] of done) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; maxStreak = Math.max(maxStreak, run); prev = d; }
  const totals = done.map(([, g]) => g.total);
  return { played: done.length, streak, maxStreak, best: totals.length ? Math.max(...totals) : 0,
    avg: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0 };
}

/* ---------- API ---------- */
const puzzleCache = new Map();
async function fetchPuzzle(date) {
  if (puzzleCache.has(date)) return puzzleCache.get(date);
  const res = await fetch(`/api/puzzle?date=${date}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const p = await res.json();
  puzzleCache.set(date, p);
  return p;
}
async function submitResult() {
  if (S.mode !== "daily" || S.g.submitted) return;
  try {
    const res = await fetch("/api/result", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: S.puzzle.date, playerId: playerId(), placements: S.g.placements }) });
    if (res.ok || res.status === 409) { S.g.submitted = true; saveGame(); }
  } catch { /* offline: try again next time the results screen opens */ }
}
async function loadServerStats() {
  try {
    const res = await fetch(`/api/stats?date=${S.puzzle.date}`);
    if (res.ok) S.server = await res.json();
  } catch { S.server = null; }
}

/* ---------- State ---------- */
const S = { view: "loading", mode: "daily", today: isoDate(new Date()), puzzle: null, g: null, sel: null, focus: null, server: null, toast: "" };
const scale = () => S.puzzle.scales[S.g.k];
function items() {
  const s = scale();
  return s.items.map((it, i) => {
    const t = S.g.placements[it.id];
    return { ...it, i, t: t === undefined ? null : t, pts: S.g.revealed ? scoreItem(s, it, t) : 0 };
  });
}
function setT(i, t) {
  const id = scale().items[i].id;
  if (t === null) delete S.g.placements[id]; else S.g.placements[id] = t;
  saveGame();
}

/* ---------- Routing ---------- */
async function route() {
  S.today = isoDate(new Date());
  S.sel = S.focus = null; S.server = null; S.toast = "";
  const h = location.hash;
  setNav(h === "#archive" ? "archive" : "home");
  if (h === "#archive") return renderArchive();
  const m = h.match(/^#play\/(\d{4}-\d{2}-\d{2})$/);
  const date = m ? m[1] : S.today;
  S.view = "loading"; render();
  try {
    S.puzzle = await fetchPuzzle(date);
  } catch {
    return notice("Couldn't load the puzzle.", "Check your connection and try again.", true);
  }
  if (!S.puzzle) {
    return date === S.today
      ? notice("No puzzle today… yet.", "Today's puzzle hasn't been published. Try the archive while you wait.")
      : notice("That puzzle isn't available.", "It may not exist, or it isn't out yet where you are.");
  }
  const daily = games("daily")[date];
  S.mode = date === S.today || daily ? "daily" : "archive";
  S.g = games(S.mode)[date] || newGame();
  S.view = S.g.done ? "done" : m || S.g.k || Object.keys(S.g.placements).length ? "play" : "home";
  render();
}
window.addEventListener("hashchange", route);
function setNav(which) { document.querySelectorAll("[data-nav]").forEach(b => b.setAttribute("aria-current", String(b.dataset.nav === which))); }
document.getElementById("nav").addEventListener("click", e => {
  const b = e.target.closest("[data-nav]"); if (!b) return;
  const target = b.dataset.nav === "archive" ? "#archive" : "";
  if (location.hash === target || (!target && !location.hash)) route(); else location.hash = target;
});
document.getElementById("home-link").addEventListener("click", e => { e.preventDefault(); if (location.hash) location.hash = ""; else route(); });

/* ---------- Rendering ---------- */
function renderMeter() {
  const m = document.getElementById("meter");
  const on = S.view === "play" && S.puzzle;
  m.hidden = !on;
  if (!on) return;
  document.getElementById("m-label").textContent = S.mode === "daily" ? "Puzzle" : "Archive";
  document.getElementById("m-num").textContent = "#" + S.puzzle.number;
  document.getElementById("m-round").textContent = `${S.g.k + 1} / ${S.puzzle.scales.length}`;
  document.getElementById("m-score").textContent = n(S.g.perScale.reduce((a, b) => a + b, 0));
}

function render() {
  renderMeter();
  if (S.view === "loading") main.innerHTML = `<p class="tray-note">Loading…</p>`;
  else if (S.view === "home") renderHome();
  else if (S.view === "play") renderPlay();
  else if (S.view === "done") renderDone();
}

function notice(title, text, retry = false) {
  S.view = "notice"; renderMeter();
  main.innerHTML = `<section class="notice"><h2 style="margin:0;font-family:var(--f-display)">${esc(title)}</h2><p style="margin:0;color:var(--muted)">${esc(text)}</p>
    <div class="cta">${retry ? `<button class="btn" id="retry">Try again</button>` : ""}<button class="btn ghosty" id="to-archive">Open the archive</button></div></section>`;
  document.getElementById("to-archive").onclick = () => (location.hash = "#archive");
  if (retry) document.getElementById("retry").onclick = route;
}

function statsGrid() {
  const st = myStats(S.today);
  return `<div class="stats">
    <div class="stat"><b>${st.streak}</b><span>Streak</span></div>
    <div class="stat"><b>${st.maxStreak}</b><span>Best streak</span></div>
    <div class="stat"><b>${st.played}</b><span>Played</span></div>
    <div class="stat"><b>${st.best ? n(st.best) : "–"}</b><span>Best score</span></div>
  </div>`;
}

function renderHome() {
  const p = S.puzzle, started = S.g.k > 0 || Object.keys(S.g.placements).length > 0;
  const fields = [...new Set(p.scales.map(s => s.field))].join(" · ");
  main.innerHTML = `<section class="home">
    <div class="hero">
      <div class="eyebrow"><span>Puzzle #${p.number}</span><span class="pill">${esc(fmtDate(p.date))}</span></div>
      <h2>How good is your sense of scale?</h2>
      <p>Three scales today: <b style="color:var(--ink)">${esc(fields)}</b>. Put five things on each scale where you think they belong. The closer you are, the more points you get.</p>
      <div class="cta"><button class="btn" id="play">${started ? "Continue" : "Play today's puzzle"}</button><span class="tray-note">About 3 minutes · max ${n(p.scales.length * ITEMS_PER_SCALE * MAX_PER_ITEM)} points</span></div>
    </div>
    ${statsGrid()}
    <div class="howto"><ol>
      <li>Drag each tag onto the scale, or tap a tag and then tap the scale.</li>
      <li>Check your placements to see the real values and your points.</li>
      <li>One puzzle a day for everyone. Share your result, keep your streak.</li>
    </ol></div>
  </section>`;
  document.getElementById("play").onclick = () => { S.view = "play"; render(); };
}

function renderPlay() {
  const s = scale(), its = items();
  const placed = its.filter(it => it.t !== null).length;
  const roundScore = its.reduce((a, it) => a + it.pts, 0);
  const isLast = S.g.k === S.puzzle.scales.length - 1;
  main.innerHTML = `
    <section class="head">
      <div class="eyebrow"><span>${esc(s.field)}</span><span class="pill">${s.type === "log" ? "logarithmic" : "linear"}</span>${s.unit ? `<span class="pill">${esc(s.unit)}</span>` : ""}${S.mode === "archive" ? `<span class="pill mode-tag">archive · #${S.puzzle.number}</span>` : ""}</div>
      <h2>${esc(s.name)}</h2>
      <p>${esc(s.question)}</p>
    </section>
    <section class="board">
      <div class="tray" id="tray">${S.g.revealed ? summaryHTML(its, roundScore) : trayHTML(its)}</div>
      <div class="gauge${S.sel !== null ? " has-sel" : ""}" id="gauge" tabindex="0" aria-label="Scale from ${esc(fmtVal(s, s.min))} to ${esc(fmtVal(s, s.max))}">
        <svg id="svg" aria-hidden="true"></svg>
        <div id="labels"></div>
        <div class="guide" id="guide" hidden><span></span></div>
      </div>
    </section>
    ${S.g.revealed ? factsHTML(its) : ""}
    <div class="actions">
      <p>${S.g.revealed
        ? `Diamonds mark the real values. The colored stripe shows how far off you were.`
        : placed < ITEMS_PER_SCALE
          ? `Drag each tag onto the scale, or tap a tag and then tap the scale. ${ITEMS_PER_SCALE - placed} left to place.`
          : `All five placed. Fine-tune by dragging, or with the arrow keys on a selected tag.`}</p>
      ${S.g.revealed
        ? `<button class="btn" id="next">${isLast ? "See results" : "Next scale →"}</button>`
        : `<button class="btn" id="check" ${placed < ITEMS_PER_SCALE ? "disabled" : ""}>Check placements</button>`}
    </div>`;
  drawGauge();
  wire();
  if (S.focus !== null) main.querySelector(`[data-label="${S.focus}"]`)?.focus({ preventScroll: true });
}

function trayHTML(its) {
  const left = its.filter(it => it.t === null);
  let h = `<div class="tray-title">Specimens · ${left.length} to place</div>`;
  h += left.map(it => `<button class="chip${S.sel === it.i ? " sel" : ""}" data-drag data-i="${it.i}" aria-pressed="${S.sel === it.i}">
      <span class="badge" style="background:var(--c${it.i})">${it.i + 1}</span><span>${esc(it.name)}</span></button>`).join("");
  if (!left.length) h += `<div class="tray-note">Tray empty. Drag the tags on the scale to adjust, then check.</div>`;
  return h;
}

function summaryHTML(its, score) {
  const rows = its.slice().sort((a, b) => b.value - a.value).map(it =>
    `<li><span class="badge" style="background:var(--c${it.i})">${it.i + 1}</span><span>${esc(it.name)}</span><span class="pts" style="color:${color(it.pts)}">+${it.pts}</span></li>`).join("");
  return `<div class="summary">
    <div class="tray-title">This scale</div>
    <div class="big">${score}<small> / ${ITEMS_PER_SCALE * MAX_PER_ITEM}</small></div>
    <ul>${rows}</ul>
  </div>`;
}

function factsHTML(its) {
  const withFacts = its.filter(it => it.fact);
  if (!withFacts.length) return "";
  return `<section class="facts"><div class="tray-title">Did you know</div>
    ${withFacts.map(it => `<p><span class="badge" style="background:var(--c${it.i})">${it.i + 1}</span><span>${esc(it.fact)} <a href="${esc(it.source)}" target="_blank" rel="noopener">source</a></span></p>`).join("")}
  </section>`;
}

function gaugeGeom() {
  const g = document.getElementById("gauge");
  const W = g.clientWidth, H = g.clientHeight;
  return { g, W, H, y: t => PAD_T + (1 - t) * (H - PAD_T - PAD_B) };
}

function drawGauge() {
  const s = scale(), its = items();
  const { W, H, y } = gaugeGeom();
  if (!W) return;
  const svg = document.getElementById("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let o = `<line x1="${AXIS_X}" y1="${PAD_T - 8}" x2="${AXIS_X}" y2="${H - PAD_B + 8}" style="stroke:var(--ink);stroke-width:2"/>`;
  const { majors, minors } = ticksFor(s);
  minors.forEach(v => { const yy = y(toT(s, v)); if (yy > PAD_T - 2 && yy < H - PAD_B + 2) o += `<line x1="${AXIS_X - 5}" x2="${AXIS_X}" y1="${yy}" y2="${yy}" style="stroke:var(--muted);stroke-width:1"/>`; });
  majors.forEach(tk => {
    const yy = y(toT(s, tk.v));
    o += `<line x1="${AXIS_X - 10}" x2="${AXIS_X}" y1="${yy}" y2="${yy}" style="stroke:var(--ink);stroke-width:1.5"/>`;
    o += `<line x1="${AXIS_X}" x2="${W}" y1="${yy}" y2="${yy}" style="stroke:var(--rule);stroke-width:1"/>`;
    o += `<text class="tick-l" x="${AXIS_X - 14}" y="${yy + 4}" text-anchor="end">${esc(tk.l)}</text>`;
  });

  // Spread labels out so they never overlap.
  const placed = its.filter(it => it.t !== null).map(it => ({ it, py: y(it.t) })).sort((a, b) => a.py - b.py);
  const LH = S.g.revealed ? 48 : 32, GAP = 5;
  const pos = [];
  placed.forEach((p, k) => { let top = p.py - LH / 2; if (k) top = Math.max(top, pos[k - 1] + LH + GAP); pos.push(Math.max(4, top)); });
  for (let k = placed.length - 1; k >= 0; k--) {
    const lim = k === placed.length - 1 ? H - LH - 4 : pos[k + 1] - LH - GAP;
    pos[k] = Math.max(4, Math.min(pos[k], lim));
  }

  if (S.g.revealed) {
    its.forEach(it => {
      const x = AXIS_X + 14 + it.i * 8, gy = y(it.t), ty = y(clamp(toT(s, it.value), 0, 1));
      const c = `var(--c${it.i})`;
      o += `<line x1="${AXIS_X}" x2="${x}" y1="${ty}" y2="${ty}" style="stroke:${c};stroke-width:1.5;stroke-dasharray:2 2"/>`;
      o += `<line x1="${x}" x2="${x}" y1="${gy}" y2="${ty}" style="stroke:${c};stroke-width:3;stroke-linecap:round;opacity:.85"/>`;
      o += `<rect class="truth" x="${x - 5}" y="${ty - 5}" width="10" height="10" transform="rotate(45 ${x} ${ty})" style="fill:${c};stroke:var(--panel);stroke-width:1.5"/>`;
    });
  }

  let labels = "";
  placed.forEach((p, k) => {
    const it = p.it, c = `var(--c${it.i})`, cy = pos[k] + LH / 2;
    o += `<path d="M${AXIS_X} ${p.py} H${AXIS_X + 10} L${LBL_X - 12} ${cy} H${LBL_X}" style="fill:none;stroke:${c};stroke-width:1.5;opacity:.7"/>`;
    o += `<circle cx="${AXIS_X}" cy="${p.py}" r="5.5" style="fill:${c};stroke:var(--panel);stroke-width:2"/>`;
    const guess = fmtVal(s, fromT(s, it.t));
    const style = `left:${LBL_X}px;top:${pos[k]}px;width:${Math.max(140, W - LBL_X - 10)}px;height:${LH}px;border-color:${c}`;
    if (S.g.revealed) {
      labels += `<div class="lbl revealed" style="${style}" data-label="${it.i}" title="${esc(verdict(it.pts))}">
        <span class="badge" style="background:${c}">${it.i + 1}</span><span class="nm">${esc(it.name)}</span>
        <span class="score" style="background:${color(it.pts)}">+${it.pts}</span>
        <span class="sub">Actual <b>${esc(fmtVal(s, it.value))}</b> · you ${esc(guess)}</span></div>`;
    } else {
      labels += `<button class="lbl" style="${style}" data-drag data-i="${it.i}" data-label="${it.i}" aria-label="${esc(it.name)} placed at ${esc(guess)}. Arrow keys move it, Delete returns it to the tray.">
        <span class="badge" style="background:${c}">${it.i + 1}</span><span class="nm">${esc(it.name)}</span><span class="val">${esc(guess)}</span></button>`;
    }
  });
  if (!placed.length) labels = `<div class="empty-hint">Drop tags anywhere along the scale. Higher means more.</div>`;
  svg.innerHTML = o;
  document.getElementById("labels").innerHTML = labels;
}

function renderDone() {
  const p = S.puzzle, max = p.scales.length * ITEMS_PER_SCALE * MAX_PER_ITEM;
  const result = scorePuzzle(p, S.g.placements);
  const pct = result.total / max;
  const title = pct >= .8 ? "Walking reference book." : pct >= .6 ? "Solid instincts." : pct >= .4 ? "Decent sense of scale." : "The universe is weird. Try again tomorrow.";
  const card = shareText(p, result, location.origin);
  const daily = S.mode === "daily";
  main.innerHTML = `<section class="end head">
    <div class="eyebrow"><span>${daily ? "Puzzle" : "Archive"} #${p.number}</span><span class="pill">${esc(fmtDate(p.date))}</span></div>
    <div class="score-xl">${n(result.total)}<small> / ${n(max)}</small></div>
    <h2 style="font-size:clamp(24px,4vw,34px)">${title}</h2>
    <div class="percentile" id="percentile">${daily ? `<span class="tray-note">Comparing with other players…</span>` : ""}</div>
    <div class="rows">${result.perScale.map((r, k) => `<div class="row"><span>${esc(p.scales[k].name)}</span><span class="bar"><i style="width:${r.score / 5}%"></i></span><span class="n">${r.score}</span></div>`).join("")}</div>
    <pre class="sharecard" id="sharecard">${esc(card)}</pre>
    <div class="share"><button class="btn" id="share">Share result</button><span class="toast" id="toast"></span></div>
    ${daily ? `${statsGrid()}<div><div class="tray-title">Next puzzle in</div><div class="countdown" id="countdown">–</div></div>` : `<div><button class="btn ghosty" id="more">More from the archive</button></div>`}
    <p class="fineprint">Values are commonly cited typical or record figures from the linked sources; many real-world numbers vary by source, sample and conditions.</p>
  </section>`;
  document.getElementById("share").onclick = () => share(card);
  if (!daily) document.getElementById("more").onclick = () => (location.hash = "#archive");
  else { startCountdown(); showPercentile(result.total); }
}

async function showPercentile(total) {
  await submitResult();
  await loadServerStats();
  const el = document.getElementById("percentile");
  if (!el || S.view !== "done") return;
  const st = S.server;
  if (!st || !st.plays) { el.innerHTML = `<span class="tray-note">You're one of the first players today.</span>`; return; }
  const mine = Math.floor(total / st.bucket);
  let below = 0, same = 0;
  for (const [b, c] of Object.entries(st.histogram)) { if (+b < mine) below += c; else if (+b === mine) same += c; }
  const beat = Math.round(100 * (below + same / 2) / st.plays);
  el.innerHTML = st.plays < 5
    ? `<span class="tray-note">${st.plays} player${st.plays === 1 ? "" : "s"} so far today. Check back later to see how you rank.</span>`
    : `You beat <b>${beat}%</b> of ${n(st.plays)} players today. <span class="tray-note">Average ${n(Math.round(st.mean))}.</span>`;
}

async function share(text) {
  const toast = document.getElementById("toast");
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast.textContent = "Copied to clipboard";
  } catch (e) {
    if (e && e.name === "AbortError") return;
    toast.textContent = "Select the text above to copy it";
  }
}

let countdownTimer;
function startCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const el = document.getElementById("countdown");
    if (!el) return clearInterval(countdownTimer);
    const now = new Date(), next = new Date(now); next.setHours(24, 0, 0, 0);
    const ms = next - now;
    if (ms <= 1000 || isoDate(now) !== S.today) {
      clearInterval(countdownTimer);
      el.innerHTML = `<button class="btn" id="newday">Today's puzzle is ready</button>`;
      document.getElementById("newday").onclick = () => { location.hash = ""; route(); };
      return;
    }
    const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1e3) % 60;
    el.textContent = [h, m, s].map(x => String(x).padStart(2, "0")).join(":");
  };
  tick(); countdownTimer = setInterval(tick, 1000);
}

async function renderArchive() {
  S.view = "archive"; renderMeter();
  main.innerHTML = `<section class="head"><div class="eyebrow"><span>Archive</span></div><h2>Past puzzles</h2><p>Replay any earlier puzzle. Archive plays don't count toward your streak or the daily stats.</p></section><div id="arch" class="tray-note">Loading…</div>`;
  let list = [];
  try { list = await (await fetch(`/api/archive?before=${S.today}`)).json(); } catch { /* shown below */ }
  const el = document.getElementById("arch");
  if (!el || S.view !== "archive") return;
  if (!Array.isArray(list) || !list.length) { el.textContent = "No past puzzles yet. Come back tomorrow."; return; }
  const d = games("daily"), a = games("archive");
  el.className = "archive";
  el.innerHTML = list.map(p => {
    const g = d[p.date]?.done ? d[p.date] : a[p.date];
    return `<button data-date="${p.date}" class="${g?.done ? "done" : ""}"><b>#${p.number}</b><span>${esc(fmtDate(p.date))}</span><span>${g?.done ? `${n(g.total)} pts` : g ? "in progress" : "not played"}</span></button>`;
  }).join("");
  el.onclick = e => { const b = e.target.closest("[data-date]"); if (b) location.hash = `#play/${b.dataset.date}`; };
}

/* ---------- Interaction (pointer drag, tap-to-place, keyboard) ---------- */
let drag = null, suppressClick = false;

function tFromPoint(cx, cy) {
  const g = document.getElementById("gauge"); if (!g) return null;
  const r = g.getBoundingClientRect();
  if (cx < r.left - 24 || cx > r.right + 24 || cy < r.top - 12 || cy > r.bottom + 12) return null;
  return clamp(1 - (cy - r.top - PAD_T) / (r.height - PAD_T - PAD_B), 0, 1);
}
function showGuide(t) {
  const guide = document.getElementById("guide"); if (!guide) return;
  if (t === null) { guide.hidden = true; return; }
  const { y } = gaugeGeom();
  guide.hidden = false; guide.style.top = y(t) + "px";
  guide.firstChild.textContent = "≈ " + fmtVal(scale(), fromT(scale(), t));
}
function onDown(e) {
  const el = e.target.closest("[data-drag]");
  if (!el || S.view !== "play" || S.g.revealed || e.button > 0) return;
  e.preventDefault();
  drag = { i: +el.dataset.i, x0: e.clientX, y0: e.clientY, moved: false, src: el, ghost: null };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
function onMove(e) {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    const it = scale().items[drag.i];
    const gh = document.createElement("div");
    gh.className = "chip ghost";
    gh.innerHTML = `<span class="badge" style="background:var(--c${drag.i})">${drag.i + 1}</span><span>${esc(it.name)}</span>`;
    document.body.appendChild(gh);
    drag.ghost = gh; drag.src.classList.add("dragging");
  }
  drag.ghost.style.transform = `translate(${e.clientX - 18}px, ${e.clientY - 20}px)`;
  showGuide(tFromPoint(e.clientX, e.clientY));
}
function endDrag() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
  if (drag && drag.ghost) drag.ghost.remove();
}
function onUp(e) {
  endDrag();
  const d = drag; drag = null;
  if (!d) return;
  if (!d.moved) {
    // A tap: select a tray tag (then tap the scale), or focus a placed tag.
    const placedT = S.g.placements[scale().items[d.i].id];
    if (placedT === undefined) { S.sel = S.sel === d.i ? null : d.i; S.focus = null; }
    else { S.sel = null; S.focus = d.i; }
    render();
    return;
  }
  const t = tFromPoint(e.clientX, e.clientY);
  setT(d.i, t); // null sends it back to the tray
  S.sel = null; S.focus = t === null ? null : d.i;
  suppressClick = true; setTimeout(() => (suppressClick = false), 0);
  render();
}
function onCancel() { endDrag(); drag = null; render(); }

main.addEventListener("pointerdown", onDown);
main.addEventListener("click", e => {
  if (S.view !== "play") return;
  const el = e.target.closest("[data-drag]");
  if (el) {
    if (e.detail !== 0) return; // pointer clicks are handled in onUp; this is keyboard Enter/Space
    const i = +el.dataset.i;
    if (S.g.placements[scale().items[i].id] === undefined) { S.sel = S.sel === i ? null : i; render(); document.getElementById("gauge").focus(); }
    return;
  }
  const g = e.target.closest("#gauge");
  if (!g || suppressClick || S.g.revealed || S.sel === null) return;
  const t = tFromPoint(e.clientX, e.clientY);
  if (t === null) return;
  setT(S.sel, t); S.focus = S.sel; S.sel = null; render();
});
main.addEventListener("keydown", e => {
  if (S.view !== "play" || S.g.revealed) return;
  const el = e.target.closest(".lbl[data-drag]");
  if (el) {
    const i = +el.dataset.i, id = scale().items[i].id;
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === "ArrowUp") setT(i, clamp(S.g.placements[id] + step, 0, 1));
    else if (e.key === "ArrowDown") setT(i, clamp(S.g.placements[id] - step, 0, 1));
    else if (e.key === "Delete" || e.key === "Backspace") { setT(i, null); S.focus = null; render(); return; }
    else return;
    e.preventDefault(); S.focus = i; render();
    return;
  }
  if (e.target.id === "gauge" && (e.key === "Enter" || e.key === " ") && S.sel !== null) {
    e.preventDefault(); setT(S.sel, 0.5); S.focus = S.sel; S.sel = null; render();
  }
});
main.addEventListener("pointermove", e => {
  if (drag || S.view !== "play" || S.sel === null || S.g.revealed || e.pointerType !== "mouse") return;
  showGuide(e.target.closest("#gauge") ? tFromPoint(e.clientX, e.clientY) : null);
});

function wire() {
  const check = document.getElementById("check");
  if (check) check.onclick = () => {
    const s = scale();
    S.g.perScale[S.g.k] = s.items.reduce((a, it) => a + scoreItem(s, it, S.g.placements[it.id]), 0);
    S.g.revealed = true; S.focus = null; saveGame(); render();
  };
  const next = document.getElementById("next");
  if (next) next.onclick = () => {
    if (S.g.k === S.puzzle.scales.length - 1) {
      S.g.done = true; S.g.total = S.g.perScale.reduce((a, b) => a + b, 0); S.view = "done";
    } else { S.g.k++; S.g.revealed = false; }
    S.sel = S.focus = null; saveGame(); render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

let rz;
new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (S.view === "play" && document.getElementById("gauge")) drawGauge(); }); }).observe(main);

route();
