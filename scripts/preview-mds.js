// Screenshots MDS mode with its demo games a few times as the fake scores swing, to check the arrows, explosions,
// missiles and lead banner by eye. Screenshots have no sound; to hear it, run wrangler dev, open ?admin, switch on
// "MDS demo games" in the gear menu and click the yellow button. The admin code (worker/admin.js) is served straight
// from the repo, standing in for the Worker's /api/.
//
// Usage: start the local server (npm start), then run: node scripts/preview-mds.js [out-dir] [dark|light]
// Writes mds-1.png ... to out-dir (default ./previews/mds, git-ignored).

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const SITE = "http://localhost:4173";
const OUT = path.resolve(process.argv[2] ?? "previews/mds");
const THEME = process.argv[3] ?? "dark";
const ADMIN_JS = fs.readFileSync(path.join(__dirname, "..", "worker", "admin.js"), "utf8");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 }, colorScheme: THEME });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
    await page.addInitScript(() => {
      for (const [k, v] of Object.entries({ selected: [], adminToken: "preview", mds: true, mdsDemo: true })) localStorage.setItem(k, JSON.stringify(v));
    });
    await page.route("**/api/admin.js", (route) => route.fulfill({ body: ADMIN_JS, contentType: "text/javascript" }));
    await page.route("**/api/visits", (route) => route.fulfill({ json: { weekly: 0, monthly: 0, total: 0 } }));
    await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
    await page.goto(`${SITE}/?admin`);
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
