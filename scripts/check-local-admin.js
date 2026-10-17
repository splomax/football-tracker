// Logs in as the admin against the real Worker running locally, to check the whole login path (password -> token ->
// admin code) without deploying.
//
// Usage: put ADMIN_PASSWORD=<something> in .dev.vars (git-ignored), run
// `npx wrangler dev --port 8788 --persist-to /tmp/wrangler-state` (its state kept out of the repo, or writing it makes
// the dev server reload itself endlessly), then:
//   node scripts/check-local-admin.js <that password>
// Prints whether the token was saved, the admin features turned on, and the gear menu's visit counts (read through the
// Worker from hits.sh). Saves a screenshot of the open menu to the path given as a second argument, if any.

const { chromium } = require("@playwright/test");

const SITE = "http://localhost:8788";
const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/check-local-admin.js <password from .dev.vars>");
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
    await page.goto(`${SITE}/?admin`);
    await page.fill("#admin-password", password);
    await page.press("#admin-password", "Enter");
    await page.waitForTimeout(3000);
    const token = await page.evaluate(() => localStorage.getItem("adminToken"));
    await page.click("#settings");
    const features = await page.locator("#visits").count();
    await page.waitForFunction(() => /\d/.test(document.getElementById("visits")?.textContent ?? ""), null, { timeout: 10000 })
      .catch(() => {});
    const visits = (await page.locator("#visits").textContent().catch(() => null)) ?? "none";
    if (process.argv[3]) await page.locator("#settings-menu").screenshot({ path: process.argv[3] });
    console.log(`address: ${page.url()}`);
    console.log(`token saved: ${token && token !== "null" ? "yes" : "no"}`);
    console.log(`admin features on: ${features ? "yes" : "no"}`);
    console.log(`visit counts: ${visits}`);
    process.exitCode = token && token !== "null" && features ? 0 : 1;
  } finally {
    await browser.close();
  }
})();
