// Screenshots joke mode (?MDS=demo) a few times as its fake games' scores swing, to check the arrows, explosions,
// missiles and lead banner by eye. Screenshots have no sound; to hear it, open http://localhost:4173/?MDS=demo
// and click the yellow button.
//
// Usage: start the local server (npm start), then run: node scripts/preview-mds.js [out-dir] [dark|light]
// Writes mds-1.png ... to out-dir (default ./previews/mds, git-ignored).

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const SITE = "http://localhost:4173";
const OUT = path.resolve(process.argv[2] ?? "previews/mds");
const THEME = process.argv[3] ?? "dark";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 }, colorScheme: THEME });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
    await page.addInitScript(() => localStorage.setItem("selected", "[]"));
    await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
    await page.goto(`${SITE}/?MDS=demo`);
    await page.waitForSelector('.card[data-key="cfb:mds-1"]');
    for (let i = 1; i <= 6; i++) {
      await page.waitForTimeout(i === 1 ? 300 : 1400);
      const file = path.join(OUT, `mds-${i}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  } finally {
    await browser.close();
  }
})();
