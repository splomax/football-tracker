// Screenshots the loud version of MDS (?mds) a few times from the moment it loads, with no games live so its fake games
// come in, to check the arrows, explosions, missiles, banners, fireworks and side scrollers by eye.
//
// Usage: start the local server (npm start), then run: node scripts/preview-mds.js [out-dir] [dark|light] [phone]
// With phone, it uses a 390x844 touch screen, where the game list drawer starts open.
// Writes mds-1.png ... to out-dir (default ./previews/mds, git-ignored).

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const SITE = "http://localhost:4173";
const OUT = path.resolve(process.argv[2] ?? "previews/mds");
const THEME = process.argv[3] ?? "dark";
const PHONE = process.argv[4] === "phone";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage(PHONE
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: THEME }
      : { viewport: { width: 1300, height: 800 }, colorScheme: THEME });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
    await page.addInitScript(() => localStorage.setItem("selected", "[]"));
    // No games at all, so the fake ones come in (and ESPN being unreachable from here doesn't matter).
    await page.route("https://site.api.espn.com/**", (route) => route.fulfill({ json: { events: [] }, headers: { "access-control-allow-origin": "*" } }));
    await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
    await page.goto(`${SITE}/?mds`);
    await page.waitForSelector('.card[data-key="cfb:mds-1"]');
    for (let i = 1; i <= 6; i++) {
      await page.waitForTimeout(i === 1 ? 100 : 1200);
      const file = path.join(OUT, `mds-${i}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  } finally {
    await browser.close();
  }
})();
