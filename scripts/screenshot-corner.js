// Screenshots the bottom corner with the gear menu open and the "google me" coach showing, on a desktop and a phone
// viewport, to check the menu and coach layout by eye.
//
// Usage: start the local server (npm start), then run: node scripts/screenshot-corner.js [out-dir]
// out-dir defaults to ./previews (git-ignored); writes corner-desktop.png and corner-phone.png.

const path = require("path");
const { chromium } = require("@playwright/test");

const SITE = "http://localhost:4173";
const OUT = path.resolve(process.argv[2] ?? "previews");

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const [name, viewport, phone] of [["desktop", { width: 1280, height: 720 }, false], ["phone", { width: 390, height: 844 }, true]]) {
      const page = await browser.newPage({ viewport, hasTouch: phone, isMobile: phone });
      await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
      await page.goto(SITE);
      if (phone) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }  // close the game list drawer
      await page.locator("#settings").scrollIntoViewIfNeeded();
      await page.click("#settings");
      await page.click("#google-me");
      await page.waitForTimeout(800);  // let the coach finish growing
      const file = path.join(OUT, `corner-${name}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})();
