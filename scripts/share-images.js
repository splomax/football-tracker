// Regenerates the link-preview image (images/og.png) and the home-screen icons: images/apple-touch-icon.png (180px,
// iPhone) and images/icon-192.png and icon-512.png (the app manifest, manifest.webmanifest).
//
// Usage: start the local server (npm start), then run: node scripts/share-images.js
//
// The preview is the app's logo (football and wordmark) over a faded screenshot of the app. Re-run this when the
// app's look changes so the screenshot stays current.

const path = require("path");
const { chromium } = require("@playwright/test");
const { cfbGames, nflGames, scoreboard } = require("../tests/fixtures");

const SITE = "http://localhost:4173";
const IMAGES = path.join(__dirname, "..", "images");
const PREVIEW_GAMES = ["cfb:1", "cfb:2", "cfb:4", "nfl:101", "cfb:7", "cfb:5"];

// The favicon is transparent; give the home-screen versions the app's dark background and some padding (the same
// proportions at every size: the ball is 140/180 of the square).
async function renderIcon(browser, size, file) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const ball = Math.round(size * 140 / 180), pad = (size - ball) / 2;
  await page.setContent(`<body style="margin: 0; background: #0f1115"><img src="${SITE}/images/favicon.svg" width="${ball}" height="${ball}" style="margin: ${pad}px"></body>`);
  await page.locator("img").evaluate((img) => img.decode());
  await page.screenshot({ path: path.join(IMAGES, file) });
  await page.close();
}

// A screenshot of the app filled with the test fixtures instead of live ESPN data, so it comes out the same every time.
// Taken in the dark theme at a larger size than the preview so more cards fit, then scaled down beside the logo.
async function screenshotApp(browser) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 683 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
  await page.addInitScript((keys) => localStorage.setItem("selected", JSON.stringify(keys)), PREVIEW_GAMES);
  await page.route("https://site.api.espn.com/**", (route) => {
    const url = route.request().url();
    if (url.includes("/summary")) return route.fulfill({ json: {}, headers: { "access-control-allow-origin": "*" } });
    const games = url.includes("college-football") ? cfbGames() : nflGames();
    route.fulfill({ json: scoreboard(games), headers: { "access-control-allow-origin": "*" } });
  });
  await page.route("https://hits.sh/**", (route) => route.abort());  // don't count this as a visit
  await page.goto(SITE);
  await page.waitForSelector(".card");
  await page.waitForTimeout(3000);  // let the team logos load and the red-zone glow finish
  // Just the cards: hide the header (the logo is drawn over it anyway), the game list, and the contact footer and gear.
  await page.addStyleTag({ content: "header, aside, #corner { display: none; } main { grid-template-columns: minmax(0, 1fr) !important; }" });
  const png = await page.screenshot();
  await page.close();
  return png;
}

// The preview is the header's logo, blown up (the football, then GAME over TRACKER with its red LIVE badge, over
// yard-line hash marks), on
// the app's dark background, with a screenshot of the app tilted away on the right. Same font, colors and proportions
// as the header (css/base.css).
async function renderPreview(browser) {
  const shot = (await screenshotApp(browser)).toString("base64");
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  // Served from the local site's own origin (not setContent's about:blank) so the self-hosted font loads without CORS.
  const html = `<style>
    @font-face { font-family: "Barlow Condensed"; font-weight: 700; src: url("${SITE}/fonts/barlow-condensed-700.woff2") format("woff2"); }
    body { margin: 0; height: 630px; overflow: hidden; position: relative; display: flex; align-items: center; gap: 32px;
      padding-left: 56px; background: #0f1115; }
    /* The app, as a window tilted away to the right and running off the edge. */
    .shot { position: absolute; left: 900px; top: 70px; width: 900px; border-radius: 12px; border: 1px solid #2a2f3a;
      box-shadow: 0 30px 80px rgba(0, 0, 0, .6); transform: perspective(1400px) rotateY(-24deg) rotateX(8deg) rotateZ(2deg);
      transform-origin: left center; opacity: .9; }
    .mark { position: relative; display: flex; align-items: center; gap: 32px; }
    .mark img { width: 190px; height: 190px; }
    h1 { display: grid; margin: 0; font-family: "Barlow Condensed", sans-serif; font-weight: 700; text-transform: uppercase; line-height: .92; }
    .l1 { font-size: 92px; letter-spacing: .16em; color: #8b93a1; }
    .l2 { display: flex; align-items: center; gap: 36px; font-size: 110px; letter-spacing: .05em; color: #e8eaed; }
    .live { padding: 6px 26px 10px;  /* less on top: the font's capitals sit low in their box */ border-radius: 20px; background: #e53935; color: #fff; font-size: 66px; letter-spacing: .08em; line-height: 1; }
    .hash { height: 22px; margin-top: 16px; background: repeating-linear-gradient(90deg, #8b93a1 0 5px, transparent 5px 34px); opacity: .7; }
  </style>
  <img class="shot" src="data:image/png;base64,${shot}" alt="">
  <div class="mark"><img src="${SITE}/images/favicon.svg" alt="">
  <h1><span class="l1">Game</span><span class="l2">Tracker<span class="live">Live</span></span><span class="hash"></span></h1></div>`;
  await page.route(`${SITE}/preview`, (route) => route.fulfill({ body: html, contentType: "text/html" }));
  await page.goto(`${SITE}/preview`);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode())); });
  if (!(await page.evaluate(() => document.fonts.check('700 110px "Barlow Condensed"')))) throw new Error("wordmark font didn't load");
  await page.screenshot({ path: path.join(IMAGES, "og.png") });
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    await renderIcon(browser, 180, "apple-touch-icon.png");
    await renderIcon(browser, 192, "icon-192.png");
    await renderIcon(browser, 512, "icon-512.png");
    await renderPreview(browser);
  } finally {
    await browser.close();
  }
})();
