// Screenshots ?mds on a 390x844 phone at 3x (like Chrome's device toolbar) while scrolling the board and the game list,
// to check that the arrows follow the scores and leave nothing behind.
//
// Usage: start the local server (npm start), then run: node scripts/check-mds-phone-scroll.js [out-dir]
// Writes board-*.png and list-*.png to out-dir (default ./previews/mds-scroll, git-ignored).

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const SITE = "http://localhost:4173";
const OUT = path.resolve(process.argv[2] ?? "previews/mds-scroll");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.addInitScript(() => localStorage.setItem("selected", "[]"));
    await page.route("https://site.api.espn.com/**", (route) => route.fulfill({ json: { events: [] }, headers: { "access-control-allow-origin": "*" } }));
    await page.route("https://hits.sh/**", (route) => route.abort());
    await page.goto(`${SITE}/?mds`);
    await page.waitForSelector('.card[data-key="cfb:mds-1"]');
    await page.waitForTimeout(500);
    const shot = async (name) => { const f = path.join(OUT, name); await page.screenshot({ path: f }); console.log(f); };
    await shot("list-1.png");
    await page.mouse.move(200, 400);
    for (let i = 2; i <= 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(400); await shot(`list-${i}.png`); }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await shot("board-1.png");
    for (let i = 2; i <= 3; i++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(400); await shot(`board-${i}.png`); }
  } finally {
    await browser.close();
  }
})();
