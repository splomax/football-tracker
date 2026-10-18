// Screenshots every feature state on a desktop (the installed Chrome) and an iPhone (Playwright's WebKit, i.e. Safari),
// from the test fixtures, for comparing desktop and mobile side by side. Writes previews/matrix/<state>-<device>.png and
// previews/matrix/index.html, which shows each state's pair in one row.
//
// Usage: start the local server (npm start), then run: node scripts/screenshot-matrix.js [state ...]
// With state names, only those are shot (see STATES below). Needs WebKit once: npx playwright install webkit.

const fs = require("fs");
const path = require("path");
const { chromium, webkit, devices } = require("@playwright/test");
const { cfbGames, nflGames, scoreboard } = require("../tests/fixtures");

const SITE = "http://localhost:4173";
const OUT = path.join(__dirname, "..", "previews", "matrix");
const ADMIN_JS = fs.readFileSync(path.join(__dirname, "..", "worker", "admin.js"), "utf8");
const CORS = { "access-control-allow-origin": "*" };
const PICKS = ["cfb:1", "cfb:2", "cfb:4", "cfb:5", "cfb:7", "nfl:101", "nfl:102"];
const ADMIN = { adminToken: "matrix", notify: true, notifyGames: ["cfb:2"] };

const { defaultBrowserType, ...iPhone } = devices["iPhone 13"];
const DEVICES = {
  desktop: { launch: () => chromium.launch({ channel: "chrome" }), context: { viewport: { width: 1300, height: 900 } } },
  phone: { launch: () => webkit.launch(), context: iPhone },
};

// Each state: what's saved in the browser, the address, and what to do before the shot.
const settle = (page, ms = 800) => page.waitForTimeout(ms);
const STATES = {
  "board-grid": { storage: { selected: PICKS, view: "grid", pickerOpen: false } },
  "board-list": { storage: { selected: PICKS, view: "list", pickerOpen: false } },
  "game-list-open": { storage: { selected: PICKS, view: "grid", pickerOpen: true } },
  "gear-menu": { storage: { selected: PICKS, view: "grid", pickerOpen: false },
    run: async (page) => { await page.click("#settings"); await settle(page, 300); } },
  "coach": { storage: { selected: PICKS, view: "grid", pickerOpen: false },
    run: async (page) => { await page.click("#settings"); await page.click("#google-me"); await settle(page); } },
  "last-play-open": { storage: { selected: PICKS, view: "grid", pickerOpen: false },
    run: async (page) => { await page.click('.card[data-key="cfb:1"] .last[data-play]'); await settle(page, 300); } },
  "conference-filter": { storage: { selected: PICKS, view: "grid", pickerOpen: true },
    run: async (page) => { await page.click("#conf"); await settle(page, 300); } },
  "empty-board": { storage: { selected: [], pickerOpen: false } },
  "game-link": { query: "?game=cfb:8", storage: { selected: ["cfb:1"], view: "grid" } },
  "admin-board": { query: "?admin", storage: { selected: PICKS, view: "grid", pickerOpen: false, ...ADMIN } },
  "admin-list-view": { query: "?admin", storage: { selected: PICKS, view: "list", pickerOpen: false, ...ADMIN } },
  "admin-game-list": { query: "?admin", storage: { selected: PICKS, view: "grid", pickerOpen: true, ...ADMIN } },
  "admin-gear-menu": { query: "?admin", storage: { selected: PICKS, view: "grid", pickerOpen: false, ...ADMIN },
    run: async (page) => { await page.click("#settings"); await settle(page, 300); } },
  "admin-login": { query: "?admin", storage: { selected: PICKS, view: "grid", pickerOpen: false }, loggedOut: true },
  "halloween": { storage: { selected: PICKS, view: "grid", pickerOpen: false, halloween: true } },
};

async function shoot(device, name, state) {
  const browser = await DEVICES[device].launch();
  try {
    const context = await browser.newContext({ ...DEVICES[device].context, colorScheme: "dark" });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-10-03T20:00:00Z"));
    await page.addInitScript((seed) => {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
      window.Notification = class { static permission = "granted"; static requestPermission = async () => "granted"; close() {} };
    }, { halloween: false, ...state.storage });
    await page.route("https://site.api.espn.com/**", (route) => {
      const url = route.request().url();
      if (url.includes("/summary")) return route.fulfill({ json: {}, headers: CORS });
      route.fulfill({ json: scoreboard(url.includes("college-football") ? cfbGames() : nflGames()), headers: CORS });
    });
    await page.route("https://a.espncdn.com/**", (route) => route.continue());
    await page.route("https://hits.sh/**", (route) => route.abort());  // don't count these as visits
    // The site's /api/: the admin code for a logged-in browser, a refusal otherwise (so ?admin asks for the password).
    await page.route("**/api/**", (route) => state.loggedOut
      ? route.fulfill({ status: 401, body: "Log in again" })
      : route.request().url().endsWith("/visits")
        ? route.fulfill({ json: { weekly: 123, monthly: 4567, total: 89012 } })
        : route.fulfill({ body: ADMIN_JS, contentType: "text/javascript" }));
    await page.goto(`${SITE}/${state.query ?? ""}`);
    await page.waitForSelector(state.loggedOut ? "#admin-login" : "#list label.game, #list .empty", { state: "attached" });
    await settle(page, 1500);  // team logos
    if (state.run) await state.run(page);
    const file = path.join(OUT, `${name}-${device}.png`);
    await page.screenshot({ path: file, fullPage: device === "phone" });
    return true;
  } catch (err) {
    console.error(`${name} (${device}): ${err.message.split("\n")[0]}`);
    return false;
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STATES);
  for (const name of names) {
    if (!STATES[name]) { console.error(`unknown state: ${name}`); continue; }
    for (const device of Object.keys(DEVICES)) if (await shoot(device, name, STATES[name])) console.log(`${name}-${device}.png`);
  }
  const rows = Object.keys(STATES).map((n) => `<tr><th>${n}</th>${Object.keys(DEVICES).map((d) =>
    `<td><a href="${n}-${d}.png"><img src="${n}-${d}.png" alt="${n} on ${d}" loading="lazy"></a></td>`).join("")}</tr>`).join("\n");
  fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Desktop vs. phone</title>
<style>body { margin: 16px; background: #0f1115; color: #e8eaed; font: 14px system-ui; } table { border-collapse: collapse; }
th { text-align: left; vertical-align: top; padding: 8px 12px 8px 0; white-space: nowrap; } td { vertical-align: top; padding: 8px; }
td img { display: block; max-height: 640px; max-width: 760px; border: 1px solid #2a2f3a; }</style>
<h1>Desktop vs. phone</h1><table><tr><th></th><th>Desktop (Chrome)</th><th>Phone (iPhone WebKit)</th></tr>
${rows}</table>`);
  console.log(path.join(OUT, "index.html"));
})();
