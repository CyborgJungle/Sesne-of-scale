// End-to-end: plays today's puzzle in a real browser using drag, tap-to-place and keyboard.
// Needs Playwright with Chromium (preinstalled in Claude cloud sessions; elsewhere `npm i -D playwright`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS; // set to a folder to save screenshots
let server, browser;

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL("../../scripts/dev.mjs", import.meta.url))], { env: { ...process.env, PORT, SUPABASE_URL: "" }, stdio: "pipe" });
  await new Promise((res, rej) => { server.stdout.on("data", d => String(d).includes("http://") && res()); server.on("exit", rej); });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function placeAll(page, mode) {
  for (let k = 0; k < 5; k++) {
    const chip = page.locator(".chip").first();
    await chip.scrollIntoViewIfNeeded();
    const box = await page.locator("#gauge").boundingBox(); // re-measure: on phones the tray above it shrinks
    const y = box.y + 40 + (k / 4) * (box.height - 80);
    const how = mode === "mixed" ? ["drag", "tap", "key", "drag", "tap"][k] : mode;
    if (how === "drag") {
      const c = await chip.boundingBox();
      await page.mouse.move(c.x + 20, c.y + c.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, y, { steps: 8 });
      await page.mouse.up();
    } else if (how === "tap") {
      await chip.click();
      const g = await page.locator("#gauge").boundingBox();
      // Clicking via the locator scrolls the gauge into view first, as a person would.
      await page.locator("#gauge").click({ position: { x: g.width / 2, y: 40 + (k / 4) * (g.height - 80) }, force: true });
    } else {
      await chip.focus();
      await page.keyboard.press("Enter");          // select → focus moves to the gauge
      await page.keyboard.press("Enter");          // place in the middle
      await page.keyboard.press("Shift+ArrowUp");  // nudge the placed tag
    }
  }
  assert.equal(await page.locator(".chip").count(), 0, "tray should be empty");
  assert.equal(await page.locator(".lbl[data-drag]").count(), 5);
}

test("plays today's daily puzzle end to end", async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  await page.goto(BASE);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/0-home.png` });
  await page.getByRole("radio", { name: /hard/i }).click();
  await page.getByRole("button", { name: /play today's puzzle/i }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-board.png` });

  for (let round = 0; round < 3; round++) {
    await placeAll(page, round === 0 ? "mixed" : round === 1 ? "tap" : "drag");
    if (SHOTS && round === 0) await page.screenshot({ path: `${SHOTS}/2-placed.png` });
    await page.getByRole("button", { name: "Check placements" }).click();
    assert.equal(await page.locator(".lbl.revealed").count(), 5);
    assert.equal(await page.locator("rect.truth").count(), 5);
    if (SHOTS && round === 0) await page.screenshot({ path: `${SHOTS}/3-reveal.png`, fullPage: true });
    await page.getByRole("button", { name: round < 2 ? /next scale/i : /see results/i }).click();
  }

  await page.locator(".score-xl").waitFor();
  const card = await page.locator("#sharecard").textContent();
  assert.match(card, /^Sense of Scale #\d+ {2}\d+\/1500\n(?:[🟩🟨🟥]{5} {2}\d+\n){3}/u);
  await page.locator("#percentile:has-text('player')").waitFor({ timeout: 5000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-results.png`, fullPage: true });

  // One play per day: reloading shows the results again, with a streak of 1.
  await page.reload();
  await page.locator(".score-xl").waitFor();
  assert.equal(await page.locator(".stat b").first().textContent(), "1");

  // The archive lists earlier puzzles and opens one in archive mode.
  await page.getByRole("button", { name: "Archive" }).click();
  await page.locator(".archive button").first().waitFor();
  await page.locator(".archive button").first().click();
  await page.locator(".mode-tag").waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test("easy mode: reorder by dragging and with the arrow buttons", async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE);
  await page.getByRole("radio", { name: /easy/i }).click();
  await page.getByRole("button", { name: /play today's puzzle/i }).click();
  for (let round = 0; round < 3; round++) {
    await page.locator(".ocard").first().waitFor();
    const before = await page.locator(".ocard .nm").allTextContents();
    // Drag the bottom card to the top.
    const last = await page.locator(".ocard").nth(4).boundingBox();
    const first = await page.locator(".ocard").nth(0).boundingBox();
    await page.mouse.move(last.x + 60, last.y + last.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 60, first.y + 4, { steps: 10 });
    await page.mouse.up();
    const afterDrag = await page.locator(".ocard .nm").allTextContents();
    assert.equal(afterDrag[0], before[4], "dragged card should be on top");
    // Move the top card down one with its ▼ button.
    await page.locator(".ocard").nth(0).getByRole("button", { name: /down/i }).click();
    assert.equal((await page.locator(".ocard .nm").allTextContents())[1], before[4]);
    if (SHOTS && round === 0) await page.screenshot({ path: `${SHOTS}/6-easy-board.png`, fullPage: true });
    await page.getByRole("button", { name: "Check order" }).click();
    assert.equal(await page.locator(".ocard.revealed").count(), 5);
    if (SHOTS && round === 0) await page.screenshot({ path: `${SHOTS}/7-easy-reveal.png`, fullPage: true });
    await page.getByRole("button", { name: round < 2 ? /next scale/i : /see results/i }).click();
  }
  await page.locator(".score-xl").waitFor();
  assert.match(await page.locator("#sharecard").textContent(), /^Sense of Scale #\d+ \(Easy\) {2}\d+\/1500/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("phone layout: tap-to-place works and nothing scrolls sideways", async () => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole("button", { name: /play today's puzzle/i }).tap();
  await placeAll(page, "tap");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-phone-dark.png`, fullPage: true });
  await ctx.close();
});
