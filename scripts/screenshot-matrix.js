// Screenshots every feature state on a desktop (the installed Chrome) and an iPhone (Playwright's WebKit, i.e. Safari),
// from the test fixtures, for comparing desktop and mobile side by side. Writes previews/matrix/<state>-<device>.png and
// previews/matrix/index.html, which shows each state's pair in one row.
//
// Usage: start the local server (npm start), then run: node scripts/screenshot-matrix.js [state ...]
// With state names, only those are shot (see STATES below). Needs WebKit once: npx playwright install webkit.
// scripts/forum-changelog.js reuses STATES and shoot() for the changelog's screenshots.

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
  // iPhone only (Safari, not the Home Screen app): the walkthrough a bell opens there, first and last steps.
  "iphone-install-help": { storage: { selected: PICKS, view: "grid", pickerOpen: false }, screenOnly: true,
    run: async (page) => { await page.click('.card[data-key="cfb:1"] [data-bell]'); await settle(page, 300); } },
  "iphone-install-help-last": { storage: { selected: PICKS, view: "grid", pickerOpen: false }, screenOnly: true,
    run: async (page) => {
      await page.click('.card[data-key="cfb:1"] [data-bell]');
      await page.click('#install-help [data-step="1"]'); await page.click('#install-help [data-step="1"]'); await settle(page, 300);
    } },
  "admin-login": { query: "?admin", storage: { selected: PICKS, view: "grid", pickerOpen: false }, loggedOut: true },
  // The stats bar (?stats), in both views.
  "stats-grid": { query: "?stats", storage: { selected: PICKS, view: "grid", pickerOpen: false } },
  "stats-list": { query: "?stats", storage: { selected: PICKS, view: "list", pickerOpen: false } },
  "stats-open": { query: "?stats", storage: { selected: PICKS, view: "grid", pickerOpen: false },
    run: async (page) => { await page.click('.card[data-key="cfb:1"] [data-stats]'); await settle(page, 300); } },
  "stats-final-open": { query: "?stats", storage: { selected: PICKS, view: "grid", pickerOpen: false },
    run: async (page) => { await page.click('.card[data-key="cfb:7"] [data-stats]'); await settle(page, 600); } },
  "stats-final-list-open": { query: "?stats", storage: { selected: PICKS, view: "list", pickerOpen: false },
    run: async (page) => { await page.click('.card[data-key="cfb:7"] [data-stats]'); await settle(page, 600); } },
  "stats-list-open": { query: "?stats", storage: { selected: PICKS, view: "list", pickerOpen: false },
    run: async (page) => { await page.click('.card[data-key="cfb:1"] [data-stats]'); await settle(page, 300); } },
  "halloween": { storage: { selected: PICKS, view: "grid", pickerOpen: false, halloween: true } },
  "mds-blue": { storage: { selected: PICKS, view: "grid", pickerOpen: false, mdsBlue: true } },
};

// ESPN's game detail: made-up leaders and team stats (stats mode) for both teams of the fixture game asked for, and a
// finished game's recap.
function sampleSummary(url) {
  const id = new URL(url).searchParams.get("event");
  const e = [...cfbGames(), ...nflGames()].find((x) => x.id === id);
  if (!e) return {};
  const teams = e.competitions[0].competitors.map((c) => c.team.id);  // home first
  const lead = (name, who, value) => ({ name, leaders: [{ displayValue: value, athlete: { shortName: who } }] });
  return {
    // A finished game has its written recap (js/recap.js), so its Recap link shows.
    ...(e.status.type.state === "post" && { article: { type: "Recap", links: { web: { href: `http://www.espn.com/ncf/recap?gameId=${id}` } } } }),
    leaders: teams.map((id, i) => ({ team: { id }, leaders: [
      lead("passingYards", ["C. Mateer", "W. Howard"][i], ["21/33, 254 YDS, 1 TD, 1 INT", "18/26, 231 YDS, 2 TD"][i]),
      lead("rushingYards", ["D. Smith", "Q. Judkins"][i], ["9 CAR, 41 YDS", "14 CAR, 88 YDS, 1 TD"][i]),
      lead("receivingYards", ["I. Teslaa", "J. Smith"][i], ["7 REC, 112 YDS, 1 TD", "6 REC, 97 YDS"][i]),
    ] })),
    boxscore: { teams: teams.map((id, i) => ({ team: { id }, statistics: Object.entries({
      totalYards: ["305", "412"][i], netPassingYards: ["254", "231"][i], rushingYards: ["51", "181"][i],
      turnovers: ["2", "0"][i], thirdDownEff: ["3-10", "6-11"][i], possessionTime: ["27:50", "32:10"][i],
    }).map(([name, displayValue]) => ({ name, displayValue })) })) },
  };
}

async function shoot(device, name, state, file = path.join(OUT, `${name}-${device}.png`)) {
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
      if (url.includes("/summary")) return route.fulfill({ json: sampleSummary(url), headers: CORS });
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
    await page.screenshot({ path: file, fullPage: device === "phone" && !state.screenOnly });  // screenOnly: just what's on screen (a dialog)
    return true;
  } catch (err) {
    console.error(`${name} (${device}): ${err.message.split("\n")[0]}`);
    return false;
  } finally {
    await browser.close();
  }
}

module.exports = { STATES, DEVICES, shoot };

if (require.main === module) (async () => {
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
