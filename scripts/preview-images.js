// Renders "Save board as image" (js/image.js) from the test fixtures as board.png, so a change to how it looks can be
// checked by eye.
//
// Usage: start the local server (npm start), then run: node scripts/preview-images.js [out-dir] [dark|light]
// out-dir defaults to ./previews (git-ignored). Logos come from ESPN as on the real site.

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
const { cfbGames, nflGames, scoreboard } = require("../tests/fixtures");

const SITE = "http://localhost:4173";
const OUT = path.resolve(process.argv[2] ?? "previews");
const THEME = process.argv[3] ?? "dark";
const PICKED = ["cfb:1", "cfb:2", "cfb:5", "cfb:6", "cfb:7", "cfb:8", "nfl:101", "nfl:102"];
const CORS = { "access-control-allow-origin": "*" };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: THEME, acceptDownloads: true });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.addInitScript((picked) => {
      localStorage.setItem("selected", JSON.stringify(picked));
    }, PICKED);
    await page.route("https://site.api.espn.com/**", (route) => {
      const url = route.request().url();
      if (url.includes("/summary")) return route.fulfill({ json: {}, headers: CORS });
      route.fulfill({ json: scoreboard(url.includes("college-football") ? cfbGames() : nflGames()), headers: CORS });
    });
    await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
    await page.goto(SITE);
    await page.waitForSelector('.board-group[data-section="pre"] .card');
    await page.waitForTimeout(2500);  // let the team logos load

    const save = async (click, name) => {
      const [download] = await Promise.all([page.waitForEvent("download"), click()]);
      await download.saveAs(path.join(OUT, name));
      console.log(path.join(OUT, name));
    };
    await page.click("#settings");
    await save(() => page.click("#save-board"), "board.png");
  } finally {
    await browser.close();
  }
})();
