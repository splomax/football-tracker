// @ts-check
const { test, expect, devices } = require("@playwright/test");
const { LONG_PLAY, cfbGames, nflGames, scoreboard, summary, PNG } = require("./fixtures");

const CORS = { "access-control-allow-origin": "*" };
// The admin Worker (worker/), stubbed: /login trades ADMIN_KEY for ADMIN_TOKEN, and /admin.js serves worker/admin.js
// and /visits the visit counts (state.visits) to ADMIN_TOKEN. Anything else is a 401.
const ADMIN_KEY = "test-password";
const ADMIN_TOKEN = "1900000000000.test-token";
const ADMIN_JS = require("fs").readFileSync(require("path").join(__dirname, "..", "worker", "admin.js"), "utf8");
const admin = { adminToken: ADMIN_TOKEN };  // spread into opts.storage to be logged in as the admin

/**
 * Stub every outside service, optionally seed localStorage, and open the app.
 * Returns a mutable state object: change state.cfb / state.nfl to alter what the next poll sees.
 */
async function open(page, opts = {}) {
  // recaps: event ids whose summary has a written recap. summaryRequests counts summary fetches per event id.
  const state = { cfb: opts.cfb ?? cfbGames(), nfl: opts.nfl ?? nflGames(), hits: 0, espnRequests: 0, adminRequests: 0, gate: opts.gate,
    visits: { weekly: 12, monthly: 345, total: 6789 }, visitsRequests: 0,
    recaps: new Set(opts.recaps ?? ["7", "8"]), summaryRequests: {}, failScoreboards: opts.failScoreboards ?? 0,
    scores: opts.scores, scoresAsks: 0, sinces: [], testAlerts: [] };
  await page.route("https://site.api.espn.com/**", async (route) => {
    const id = route.request().url().match(/summary\?event=(\w+)/)?.[1];
    if (id) {
      state.summaryRequests[id] = (state.summaryRequests[id] ?? 0) + 1;
      return route.fulfill({ json: summary(id, state.recaps.has(id)), headers: CORS });
    }
    state.espnRequests++;
    if (state.failScoreboards > 0) { state.failScoreboards--; return route.abort(); }  // opts.failScoreboards: the first n fail
    if (state.gate) await state.gate;
    const games = route.request().url().includes("college-football") ? state.cfb : state.nfl;
    await route.fulfill({ json: scoreboard(games), headers: CORS });
  });
  await page.route("https://a.espncdn.com/**", (route) =>
    opts.missingLogo && route.request().url().includes(opts.missingLogo)
      ? route.fulfill({ status: 404, headers: CORS })
      : route.fulfill({ body: PNG, contentType: "image/png", headers: CORS }));
  // The site's own /api/ (worker/handler.js); the local test server only has the static files.
  await page.route("**/api/**", (route) => {
    const req = route.request(), headers = {};
    state.adminRequests++;
    const auth = req.headers().authorization;
    if (req.url().endsWith("/login") && req.method() === "POST" && auth === `Bearer ${ADMIN_KEY}`) {
      return route.fulfill({ json: { token: ADMIN_TOKEN }, headers });
    }
    if (req.url().endsWith("/admin.js") && auth === `Bearer ${ADMIN_TOKEN}`) {
      return route.fulfill({ body: ADMIN_JS, contentType: "text/javascript", headers });
    }
    if (req.url().endsWith("/visits") && auth === `Bearer ${ADMIN_TOKEN}`) {
      state.visitsRequests++;
      return route.fulfill({ json: state.visits, headers });
    }
    // The program on Cloudflare that fetches the scores, when a test sets opts.scores (its answer, a function of the
    // page's `since`, or "down"); otherwise refused, so admin pages fall back to ESPN as the other tests expect.
    if (new URL(req.url()).pathname.endsWith("/games") && auth === `Bearer ${ADMIN_TOKEN}`) {
      const since = new URL(req.url()).searchParams.get("since");
      state.scoresAsks++;
      state.sinces.push(since);
      if (!state.scores) return route.fulfill({ status: 401, body: "Nope", headers });
      if (state.scores === "down") return route.fulfill({ status: 500, body: "Down", headers });
      return route.fulfill({ json: typeof state.scores === "function" ? state.scores(since) : state.scores, headers });
    }
    if (req.url().endsWith("/test-alert") && req.method() === "POST" && auth === `Bearer ${ADMIN_TOKEN}`) {
      state.testAlerts.push(JSON.parse(req.postData()).key);
      return route.fulfill({ json: { ok: true }, headers });
    }
    return route.fulfill({ status: 401, body: "Nope", headers });
  });
  await page.route("https://hits.sh/**", (route) => {
    state.hits++;
    return route.fulfill({ body: "<svg xmlns='http://www.w3.org/2000/svg'/>", contentType: "image/svg+xml" });
  });
  // Off unless a test asks (opts.halloween: true, or null to let the date decide): the real date would otherwise turn it
  // on every October, changing the logo and "google me".
  await page.addInitScript((on) => localStorage.setItem("halloween", JSON.stringify(on)), "halloween" in opts ? opts.halloween : false);
  if (opts.storage) {
    // Seed once per test; later reloads must see what the app itself saved.
    await page.addInitScript((seed) => {
      if (sessionStorage.getItem("seeded")) return;
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem("seeded", "1");
    }, opts.storage);
  }
  await page.goto(`/index.html${opts.query ?? ""}`);
  // The first load can take a while when every worker is loading pages at once, so wait longer than the usual 5s.
  if (!opts.gate) await expect(page.locator("#list label.game").first()).toBeAttached({ timeout: 15_000 });
  return state;
}

const row = (page, key) => page.locator(`#list label.game:has(input[data-key="${key}"])`);
const card = (page, key) => page.locator(`.card[data-key="${key}"]`);
const rowKeys = (page, group) => page.locator(`#list .group-label[data-group="${group}"] + .group-body input`)
  .evaluateAll((inputs) => inputs.map((i) => i.dataset.key));
const style = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);
const ALL_CFB = ["cfb:1", "cfb:2", "cfb:3", "cfb:4", "cfb:5", "cfb:6", "cfb:7", "cfb:8"];

test.describe("loading and layout", () => {
  test("a failed first answer from ESPN keeps the list's spinner, and the next poll fills it without waiting for the 30s refresh", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    await open(page, { failScoreboards: 2, gate: Promise.resolve() });  // both leagues' first answers fail; gate: don't wait for rows
    await expect(page.locator("#list .spinner")).toBeVisible();
    await expect(page.locator("#list")).not.toContainText("No games this week");
    await page.clock.runFor(10_000);  // the next poll, well inside the list's 30s refresh
    await expect(page.locator("#list label.game").first()).toBeAttached();
  });

  test("shows spinners until the first data arrives", async ({ page }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    await open(page, { gate });
    await expect(page.locator("#list .spinner")).toBeVisible();
    await expect(page.locator("#board .spinner")).toBeVisible();
    // The spinner is the favicon football with its laces rolling.
    expect(await style(page.locator("#board .spinner .laces"), "animationName")).toBe("spiral");
    release();
    await expect(page.locator("#list label.game").first()).toBeVisible();
    await expect(page.locator(".spinner")).toHaveCount(0);
  });

  test("loads every file and runs with no console errors or failed requests", async ({ page }) => {
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
    page.on("response", (r) => { if (r.url().startsWith("http://localhost") && r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
    await open(page, { storage: { selected: ["cfb:1"] } });
    await page.locator("#settings").click();
    await page.locator("#google-me").click();
    await expect(page.locator("#coach img")).toHaveJSProperty("complete", true);
    expect(await page.locator("#coach img").evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("picker tabs are College then NFL, with College the default", async ({ page }) => {
    await open(page);
    await expect(page.locator(".tabs button")).toHaveText(["College", "NFL"]);
    await expect(page.locator('.tabs button[data-league="cfb"]')).toHaveClass(/on/);
  });

  test("a tab saved from the old All option falls back to College", async ({ page }) => {
    await open(page, { storage: { tab: "all" } });
    await expect(page.locator('.tabs button[data-league="cfb"]')).toHaveClass(/on/);
    await expect(row(page, "nfl:101")).toHaveCount(0);
  });

  test("remembers the chosen tab across reloads", async ({ page }) => {
    await open(page);
    await page.locator('.tabs button[data-league="nfl"]').click();
    await expect(row(page, "nfl:101")).toBeAttached();
    await page.reload();
    await expect(page.locator('.tabs button[data-league="nfl"]')).toHaveClass(/on/);
  });

  test('shows "Games updated at" with a local time', async ({ page }) => {
    await open(page);
    await expect(page.locator("#updated")).toHaveText(/^Games updated at \d{1,2}:\d{2}:\d{2}/);
  });

  test("has a favicon and link-preview tags whose images exist", async ({ page, request }) => {
    await open(page);
    const attr = (sel, a) => page.locator(sel).getAttribute(a);
    expect(await attr('meta[property="og:title"]', "content")).toBe("Game Tracker Live");
    expect(await attr('meta[property="og:description"]', "content")).toBeTruthy();
    expect(await attr('meta[name="twitter:card"]', "content")).toBe("summary_large_image");
    const live = "https://gametrackerlive.com/";
    const og = await attr('meta[property="og:image"]', "content");
    expect(og.startsWith(live)).toBe(true);  // previews need absolute URLs
    for (const path of [og.slice(live.length), await attr('link[rel="icon"]', "href"), await attr('link[rel="apple-touch-icon"]', "href")]) {
      expect((await request.get("/" + path)).status(), path).toBe(200);
    }
  });

  test("dark color scheme, so native scrollbars and controls are dark", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  });

  test("contact footer and settings gear sit in the bottom-right corner", async ({ page }) => {
    await open(page);
    await expect(page.locator("#contact")).toHaveText("contact: sean@gametrackerlive.com");
    const gear = await page.locator("#settings").boundingBox();
    const contact = await page.locator("#contact").boundingBox();
    expect(gear.x + gear.width).toBeLessThanOrEqual(contact.x + 1);  // gear is left of contact
    expect(contact.x + contact.width).toBeGreaterThan(1300 - 2);     // flush right
  });
});

test.describe("?league= links", () => {
  const tabOn = (page, league) => expect(page.locator(`.tabs button[data-league="${league}"]`)).toHaveClass(/on/);

  test("?league=nfl opens the picker on NFL, overriding a saved College choice", async ({ page }) => {
    await open(page, { query: "?league=nfl", storage: { tab: "cfb" } });
    await tabOn(page, "nfl");
  });

  test("the choice sticks after visiting without the parameter", async ({ page }) => {
    await open(page, { query: "?league=nfl", storage: { selected: ["nfl:101"] } });
    await tabOn(page, "nfl");
    await page.goto("/index.html");
    await tabOn(page, "nfl");
  });

  test("?league=college opens on College; an unknown value changes nothing", async ({ page }) => {
    await open(page, { query: "?league=college", storage: { tab: "nfl", selected: ["cfb:1"] } });
    await tabOn(page, "cfb");
    await page.goto("/index.html?league=hockey");
    await tabOn(page, "cfb");
  });
});

test.describe("?game= links", () => {
  test("?game= adds the game to the viewer's own picks, highlights it, and leaves the address bar", async ({ page }) => {
    await open(page, { query: "?game=cfb:2", storage: { selected: ["cfb:1"] } });
    await expect(card(page, "cfb:2")).toHaveClass(/flash/);
    await expect(card(page, "cfb:1")).toBeAttached();
    expect(new URL(page.url()).search).toBe("");
    await card(page, "cfb:2").hover();
    await card(page, "cfb:2").locator(".remove").click();
    await page.reload();
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect(card(page, "cfb:2")).toHaveCount(0);  // a refresh doesn't bring back a removed linked game
  });

  test("several games, repeated or comma-separated; junk keys are ignored", async ({ page }) => {
    await open(page, { query: "?game=cfb:1,nfl:101&game=cfb:3&game=hockey:9" });
    await expect(page.locator("#board .card")).toHaveCount(3);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("selected")).sort())).toEqual(["cfb:1", "cfb:3", "nfl:101"]);
  });
});

test.describe("Safari keeps the scroll position through refreshes @webkit", () => {
  // WebKit (Safari) clamps the scroll to the top while it lays out the board's new contents (CSS size containers), so
  // every 10-second redraw used to jump a phone scrolled to the bottom back to the top, and the board on desktop. Chrome
  // never did, so these run in the webkit project (playwright.config.js).
  const picks = [...ALL_CFB, "nfl:101", "nfl:102"];

  test.describe("on a phone", () => {
    const { defaultBrowserType, ...iPhone } = devices["iPhone 13"];
    test.use(iPhone);
    for (const view of ["list", "grid"]) {
      test(`scrolled to the bottom, it stays there (${view} view)`, async ({ page }) => {
        await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
        await open(page, { storage: { selected: picks, pickerOpen: false, view } });
        const y = await page.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); return scrollY; });
        expect(y).toBeGreaterThan(300);
        await page.clock.runFor(20_000);  // two polls
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
      });
    }
  });

  test("the desktop board scrolled to the bottom stays there", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 560 });  // over 500px tall, or it gets the phone layout
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    await open(page, { storage: { selected: picks, view: "grid" } });
    const y = await page.locator("#board").evaluate((b) => { b.scrollTop = b.scrollHeight; return b.scrollTop; });
    expect(y).toBeGreaterThan(300);
    await page.clock.runFor(20_000);
    await expect.poll(() => page.locator("#board").evaluate((b) => b.scrollTop)).toBe(y);
  });
});

test.describe("grid and list views", () => {
  test("the header button switches everyone's board to one row per game and back, and remembers the choice", async ({ page }) => {
    // (Desktop starts in grid; phones start in list, in the mobile tests.)
    await open(page, { storage: { selected: ["cfb:1", "cfb:2", "cfb:7", "cfb:5"] } });
    const toggle = page.locator("#view-toggle");
    await expect(toggle).toHaveAttribute("aria-label", "Switch to list view");
    await expect(page.locator("#board .card.line")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Switch to grid view");
    await expect(page.locator("#board .card.line")).toHaveCount(4);
    // One column, every row the same width (only as wide as needed, not the board's), sections kept.
    const boxes = await page.locator("#board .card").evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect()).map(({ left, width }) => ({ left, width })));
    expect(new Set(boxes.map((b) => b.left)).size).toBe(1);
    expect(new Set(boxes.map((b) => Math.round(b.width))).size).toBe(1);
    await expect(page.locator("#board .board-section")).toHaveText(["Live", "Final", "Upcoming"]);
    const live = card(page, "cfb:1");
    await expect(live).toHaveClass(/redzone/);
    await expect(live.locator(".dd")).toHaveText("3rd & 6 at IOWA 12");
    await expect(page.locator("#board .last")).toHaveCount(0);  // no last play
    expect(boxes[0].width).toBeLessThan(await page.locator("#board").evaluate((b) => b.clientWidth - 32));
    // The down & distance is centered under the scores (the "@").
    const center = (el) => el.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; });
    expect(Math.abs(await center(live.locator(".dd")) - await center(live.locator(".at")))).toBeLessThan(2);
    await expect(card(page, "cfb:7").locator(".net")).toContainText("CBS / Paramount+");
    // The network sits on the second line, at the left under the away team.
    const [net, away] = await Promise.all([card(page, "cfb:7").locator(".net").boundingBox(), card(page, "cfb:7").locator(".team.away").boundingBox()]);
    expect(net.y).toBeGreaterThan(away.y + away.height - 2);
    expect(Math.abs(net.x - away.x)).toBeLessThan(2);  // same left edge (both pad 12px in from the row's edge)
    await expect(card(page, "cfb:7").locator(".recap")).toBeAttached();
    await page.reload();
    await expect(page.locator("#board .card.line")).toHaveCount(4);
    await page.locator("#view-toggle").click();
    await expect(page.locator("#board .card.line")).toHaveCount(0);
    await expect(page.locator("#board .field")).toHaveCount(2);
  });

  test("a list row's ✕ removes the game", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:2"], view: "list" } });
    await card(page, "cfb:2").hover();
    await card(page, "cfb:2").locator(".remove").click();
    await expect(card(page, "cfb:2")).toHaveCount(0);
    await expect(row(page, "cfb:2").locator("input")).not.toBeChecked();
  });
});

test.describe("Halloween", () => {
  test("every October the header has a jack-o'-lantern that turns around its stem when clicked", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-31T20:00:00"));
    await open(page, { halloween: null });  // no override: the date decides
    await expect(page.locator("html")).toHaveAttribute("data-season", "halloween");
    await expect(page.locator("#logo .pumpkin")).toBeVisible();
    await expect(page.locator("#logo .football")).toBeHidden();
    await expect(page.locator("#logo")).toHaveAttribute("aria-label", "Turn the jack-o'-lantern");
    await page.locator("#logo").click();
    expect(await style(page.locator("#logo .pumpkin .face"), "animationName")).toBe("pumpkin-turn");
    expect(await style(page.locator("#logo .pumpkin"), "animationName")).toBe("none");  // the pumpkin itself stays put
  });

  test("the loading spinners are jack-o'-lanterns too, faces turning", async ({ page }) => {
    let release;
    await open(page, { halloween: true, gate: new Promise((r) => (release = r)) });
    for (const at of ["#list", "#board"]) {
      await expect(page.locator(`${at} .spinner .pumpkin`)).toBeVisible();
      await expect(page.locator(`${at} .spinner .ball`)).toBeHidden();
      expect(await style(page.locator(`${at} .spinner .face`), "animationName")).toBe("pumpkin-turn");
    }
    release();
    await expect(page.locator(".spinner")).toHaveCount(0);
  });

  test("from November 1 it's the football again", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-01T09:00:00"));
    await open(page, { halloween: null });
    await expect(page.locator("html")).not.toHaveAttribute("data-season", "halloween");
    await expect(page.locator("#logo .football")).toBeVisible();
    await expect(page.locator("#logo .pumpkin")).toBeHidden();
  });

  test("google me shows a ghost one time in four, and the coaches the rest of the time", async ({ page }) => {
    // Each showing rolls for the ghost (under .25), then if not, for Pelini (under .1).
    await page.addInitScript(() => { const rolls = [0.1, 0.6, 0.05, 0.6, 0.6]; Math.random = () => rolls.shift() ?? 0.6; });
    await open(page, { halloween: true });
    const coach = page.locator("#coach img");
    for (const src of ["images/ghost.svg", "images/pelini.png", "images/cignetti.png"]) {
      await page.locator("#settings").click();
      await page.locator("#google-me").click();
      await expect(coach).toHaveAttribute("src", src);
      await page.waitForTimeout(600);
      await page.locator("#coach").click();
      await expect(page.locator("#coach")).toBeHidden();
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("board image", () => {
  // Opens the gear menu and clicks Save board as image; resolves with the PNG's bytes and the download's name.
  const saveBoard = async (page) => {
    await page.locator("#settings").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#save-board").click()]);
    return { png: require("fs").readFileSync(await download.path()), name: download.suggestedFilename() };
  };

  test("everyone's gear menu has Save board as image, and no section has a Save as image button", async ({ page }) => {
    await open(page, { storage: { selected: ALL_CFB } });
    for (const st of ["in", "post", "pre"]) await expect(page.locator(`.board-group[data-section="${st}"]`)).toBeAttached();
    await expect(page.locator("#board .board-section button")).toHaveCount(0);
    await page.locator("#settings").click();
    await expect(page.locator("#save-board")).toHaveText("Save board as image");
  });

  test("the admin's gear menu shows the visit counts, fresh each time it opens", async ({ page }) => {
    const state = await open(page, { query: "?admin", storage: admin });
    const visits = page.locator("#visits");
    await page.locator("#settings").click();
    await expect(visits).toHaveText(/12\s*week\s*345\s*month\s*6789\s*total/);
    await page.locator("#settings").click();  // closing doesn't fetch
    await expect(page.locator("#settings")).toHaveAttribute("aria-expanded", "false");
    const fetched = state.visitsRequests;
    state.visits = { weekly: 13, monthly: 346, total: 6790 };
    await page.locator("#settings").click();
    await expect(visits).toHaveText(/13\s*week\s*346\s*month\s*6790\s*total/);
    expect(state.visitsRequests).toBe(fetched + 1);
  });

  test("regular visitors' gear menu has no visit counts", async ({ page }) => {
    const state = await open(page, { storage: admin });  // logged in, but no ?admin
    await page.locator("#settings").click();
    await expect(page.locator("#google-me")).toBeVisible();
    await expect(page.locator("#visits")).toHaveCount(0);
    expect(state.visitsRequests).toBe(0);
  });

  test("Save board as image downloads every game on the board as a list, one row per game plus a day heading", async ({ page }) => {
    const selected = [...ALL_CFB, "nfl:101", "nfl:102"];
    await open(page, { storage: { selected } });
    await expect(card(page, "nfl:102")).toBeAttached();
    const { png, name } = await saveBoard(page);
    expect(name).toBe("game-tracker-live.png");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // Drawn at 2x: 640 wide, and its height grows by one 44px row per game and 34px per Eastern day.
    const dates = [...cfbGames().map((e) => ["cfb:" + e.id, e.date]), ...nflGames().map((e) => ["nfl:" + e.id, e.date])]
      .filter(([key]) => selected.includes(key)).map(([, date]) => date);
    expect(dates).toHaveLength(selected.length);
    const days = new Set(dates.map((d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" }))).size;
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(2 * (24 + days * 34 + selected.length * 44 + 34 + 12));
  });

  test("a team with no dark-mode logo doesn't break the image", async ({ page }) => {
    await open(page, { missingLogo: "500-dark/17.png", storage: { selected: ["nfl:101"] } });
    await expect(card(page, "nfl:101")).toBeAttached();
    expect((await saveBoard(page)).png.subarray(1, 4).toString()).toBe("PNG");
  });

  test.describe("in a time zone far from Eastern", () => {
    test.use({ timezoneId: "Asia/Tokyo" });  // local and Eastern times differ (and so do days)

    test("kickoff times and days are in Eastern time", async ({ page }) => {
      // 23:30Z Oct 3 is Saturday 7:30 PM Eastern; 14:00Z Oct 4 is Sunday 10:00 AM. In Tokyo both fall on Sunday.
      const cfb = cfbGames().map((e) => (e.id === "6" ? { ...e, date: "2026-10-04T14:00Z" } : e));
      await open(page, { cfb, storage: { selected: ["cfb:5", "cfb:6"] } });
      await expect(card(page, "cfb:6")).toBeAttached();
      const { png } = await saveBoard(page);
      expect(png.readUInt32BE(20)).toBe(2 * (24 + 2 * 34 + 2 * 44 + 34 + 12));  // two day headings, not one
    });

    test("under Top 25 the board and the list still go by kickoff, not rank", async ({ page }) => {
      // Sunday's game has the best-ranked team, but Saturday's still comes first.
      const cfb = cfbGames().map((e) => (e.id === "6" ? { ...e, date: "2026-10-04T17:00Z",
        competitions: [{ ...e.competitions[0], competitors: e.competitions[0].competitors.map((c) => ({ ...c, curatedRank: { current: 1 } })) }] } : e));
      await open(page, { cfb, storage: { selected: ["cfb:5", "cfb:6", "nfl:102"], filters: { cfb: { confs: [], top25: true }, nfl: { confs: [] } } } });
      const board = page.locator('.board-group[data-section="pre"] .card');
      await expect(board).toHaveCount(3);
      expect(await board.evaluateAll((cs) => cs.map((c) => c.dataset.key))).toEqual(["cfb:5", "cfb:6", "nfl:102"]);
      const { png } = await saveBoard(page);
      expect(png.readUInt32BE(20)).toBe(2 * (24 + 2 * 34 + 3 * 44 + 34 + 12));  // Saturday, Sunday: two headings, not three
    });
  });
});

// Games as the program on Cloudflare sends them (js/espn.js's shape, dates as text).
const serverTeam = (id, abbr, score) => ({ id, abbr, name: abbr, logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`, conf: "5", color: "#555", score });
const serverGame = (key, away, home, over = {}) => ({ key, date: "2026-10-03T19:00:00Z", state: "in", detail: "6:06 - 3rd", clock: "6:06", period: 3,
  away, home, yardLine: 60, possession: away.id, ddText: "2nd & 4 at MICH 40", redZone: false, lastPlay: "Rush for 6 yards", network: "BTN", ...over });
const SERVER = { games: { nfl: [], cfb: [serverGame("cfb:77", serverTeam("356", "ILL", "17"), serverTeam("130", "MICH", "14"))] }, confNames: { 5: "Big Ten" },
  alerts: [], cursor: 0 };

test.describe("installing on a phone", () => {
  test("the app manifest names the app, shows it full screen, and its icons exist", async ({ page, request }) => {
    await open(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(`/${href}`)).json();
    expect(manifest).toMatchObject({ name: "Game Tracker Live", short_name: "Game Tracker", display: "standalone" });
    expect(manifest.start_url).toBeUndefined();  // so the app opens on the page it was added from, like /?admin
    for (const icon of manifest.icons) {
      const res = await request.get(`/${icon.src}`);
      expect(res.status(), icon.src).toBe(200);
      const png = await res.body();
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
  });

  test("admin pages register the service worker that will receive phone notifications; other pages don't", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration())).toBeUndefined();
    await page.evaluate((token) => localStorage.setItem("adminToken", JSON.stringify(token)), ADMIN_TOKEN);
    await page.goto("/index.html?admin");
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? null))
      .toBe("http://localhost:4173/sw.js");
  });
});

test.describe("scores from the program on Cloudflare", () => {
  const sourceLine = async (page) => { await page.locator("#settings").click(); return page.locator("#score-source"); };

  test("the admin's page gets its scores from the program, and the gear menu says so", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { query: "?admin", scores: SERVER, storage: { ...admin, selected: ["cfb:77"] } });
    await expect(card(page, "cfb:77")).toBeAttached();  // a game only the program has, right after the admin features load
    await expect(card(page, "cfb:77").locator(".dd")).toHaveText("2nd & 4 at MICH 40");
    expect(state.scoresAsks).toBeGreaterThan(0);
    await expect(await sourceLine(page)).toHaveText("Scores from: Game Tracker server");
  });

  test("when the program can't be reached, the admin's page gets its scores from ESPN, and the gear menu says so", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { query: "?admin", scores: "down", storage: { ...admin, selected: ["cfb:3"] } });
    await page.clock.runFor(10_000);
    await expect.poll(() => state.scoresAsks).toBeGreaterThan(0);
    await expect(card(page, "cfb:3")).toBeAttached();  // WYO–NDSU comes only from ESPN's fixtures
    await expect(await sourceLine(page)).toHaveText("Scores from: ESPN (server unreachable)");
  });

  test("everyone else's page never asks the program", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { scores: SERVER, storage: { ...admin, selected: ["cfb:1"] } });  // logged in, no ?admin
    await page.clock.runFor(20_000);
    expect(state.scoresAsks).toBe(0);
    await expect(page.locator("#score-source")).toHaveCount(0);
  });
});

test.describe("notifications", () => {
  // A stand-in for the browser's Notification: records what's sent (window.sent), starts at `permission` and answers
  // the permission prompt with `answer`.
  const fakeNotifications = (page, answer = "granted", permission = "default") => page.addInitScript(([answer, permission]) => {
    window.sent = [];
    window.Notification = class {
      static permission = permission;
      static async requestPermission() { return (Notification.permission = answer); }
      constructor(title, options) { window.sent.push({ title, ...options }); }
      close() {}
    };
  }, [answer, permission]);
  const sent = (page) => page.evaluate(() => window.sent.map(({ title, body }) => ({ title, body })));
  test("only the admin gets Enable notifications; turning it on sends a test notification and puts a bell on every card", async ({ page }) => {
    await fakeNotifications(page);
    await open(page, { storage: { ...admin, selected: ["cfb:2", "cfb:5"] } });  // logged in, but no ?admin
    await page.locator("#settings").click();
    await expect(page.locator("#google-me")).toBeVisible();
    await expect(page.locator("#notify")).toHaveCount(0);
    await page.goto("/index.html?admin");
    await expect(card(page, "cfb:5")).toBeAttached();
    await page.locator("#settings").click();
    const toggle = page.locator("#notify");
    await expect(toggle).toHaveText("✓Enable notifications");
    await expect(page.locator("#board .bell")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect((await sent(page))[0].title).toBe("Notifications are on");
    await expect(page.locator("#board .bell")).toHaveCount(2);  // live and upcoming alike
    await expect(page.locator("#board .bell.on")).toHaveCount(0);
    await toggle.click();
    await expect(page.locator("#board .bell")).toHaveCount(0);
  });

  // The program's answer, handing out `alerts` (numbered from 1) to pages that have seen fewer, none to a page just opening.
  const withAlerts = (alerts) => (since) => ({ ...SERVER, cursor: alerts.length,
    games: { nfl: [], cfb: [serverGame("cfb:77", serverTeam("356", "ILL", "17"), serverTeam("130", "MICH", "14")),
      serverGame("cfb:78", serverTeam("194", "OSU", "24"), serverTeam("2294", "IOWA", "6"))] },
    alerts: since == null ? [] : alerts.map((a, i) => ({ id: i + 1, at: 0, ...a })).filter((a) => a.id > Number(since)) });

  test("the program's notifications show for a lit bell's game, not an unlit one's; a test notification always shows", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    await fakeNotifications(page, "granted", "granted");
    const alerts = [];
    const state = await open(page, { query: "?admin", scores: withAlerts(alerts), storage: { ...admin, selected: ["cfb:77", "cfb:78"], notify: true, notifyGames: ["cfb:77"] } });
    await expect(card(page, "cfb:77")).toBeAttached();
    expect(state.sinces[0]).toBe(null);  // a page just opening asks for no old notifications
    alerts.push({ key: "cfb:77", title: "MICH touchdown", body: "ILL 17, MICH 21 · 6:06 - 3rd\nPass for 30 yards" },
      { key: "cfb:78", title: "OSU field goal", body: "OSU 27, IOWA 6 · 6:06 - 3rd" },  // unlit bell
      { key: "cfb:78", title: "Test notification", body: "OSU 24, IOWA 6 · 6:06 - 3rd\nSent through the Game Tracker server", forced: true });
    await page.clock.runFor(10_000);
    await expect.poll(() => sent(page)).toEqual([
      { title: "MICH touchdown", body: "ILL 17, MICH 21 · 6:06 - 3rd\nPass for 30 yards" },
      { title: "Test notification", body: "OSU 24, IOWA 6 · 6:06 - 3rd\nSent through the Game Tracker server" },
    ]);
    await page.clock.runFor(10_000);
    await expect.poll(() => state.sinces.at(-1)).toBe("3");  // it then asks only for newer ones
    expect(await sent(page)).toHaveLength(2);
  });

  test("each card's paper plane sends that game a test notification through the program, and updates right away", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    await fakeNotifications(page, "granted", "granted");
    const state = await open(page, { query: "?admin", scores: withAlerts([]), storage: { ...admin, selected: ["cfb:77"], notify: true } });
    await expect(card(page, "cfb:77")).toBeAttached();
    const asks = state.scoresAsks;
    await card(page, "cfb:77").hover();
    await card(page, "cfb:77").locator(".test-alert").click();
    await expect.poll(() => state.testAlerts).toEqual(["cfb:77"]);
    await expect.poll(() => state.scoresAsks).toBeGreaterThan(asks);  // without waiting for the next 10-second update
  });

  test("each picked game's row in the game list gets a bell that shows and toggles its notifications", async ({ page }) => {
    await fakeNotifications(page, "granted", "granted");
    await open(page, { query: "?admin", storage: { ...admin, selected: ["cfb:1", "cfb:2"], notify: true, pickerOpen: true } });
    await expect(page.locator("#list .row-bell")).toHaveCount(2);  // picked games only
    const rowBell = row(page, "cfb:2").locator(".row-bell");
    await expect(rowBell).toHaveAttribute("aria-pressed", "false");
    await expect(rowBell).toHaveCSS("opacity", "0");  // off: only on hover
    await row(page, "cfb:2").hover();
    await expect(rowBell).toHaveCSS("opacity", "1");
    await rowBell.click();
    await expect(row(page, "cfb:2").locator(".row-bell")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(0, 0);
    const lit = row(page, "cfb:2").locator(".row-bell");
    await expect(lit).toHaveCSS("opacity", "1");  // on: always, in yellow
    expect(await lit.evaluate((b) => getComputedStyle(b).color)).toBe(await page.evaluate(() => {
      const probe = Object.assign(document.createElement("span"), { style: "color: var(--poss)" });
      document.body.append(probe);
      return getComputedStyle(probe).color;
    }));
    await expect(card(page, "cfb:2").locator(".bell")).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, "cfb:2").locator("input")).toBeChecked();  // still picked
    const yellow = await page.evaluate(() => {
      const probe = Object.assign(document.createElement("span"), { style: "color: var(--poss)" });
      document.body.append(probe);
      return getComputedStyle(probe).color;
    });
    await expect(card(page, "cfb:2").locator(".bell")).toHaveCSS("background-color", yellow);  // lit card bell: yellow
    await card(page, "cfb:2").locator(".bell").click({ force: true });  // and the card's bell turns the row's off
    await expect(row(page, "cfb:2").locator(".row-bell")).toHaveAttribute("aria-pressed", "false");
  });

  test("a refused permission says so and stays off", async ({ page }) => {
    await fakeNotifications(page, "denied");
    await open(page, { query: "?admin", storage: { ...admin, selected: ["cfb:2"] } });
    await page.locator("#settings").click();
    await page.locator("#notify").click();
    await expect(page.locator("#notify")).toHaveText("✓Notifications blocked");
    await expect(page.locator("#notify")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#board .bell")).toHaveCount(0);
    expect(await sent(page)).toEqual([]);
  });
});

test.describe("bulk select in the game list", () => {
  test("Remove all also catches a game that ended after the list was last drawn", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { query: "?admin", storage: { ...admin, selected: ["cfb:1", "cfb:7"], pickerOpen: true } });
    await expect(page.locator(".group-actions").first()).toBeAttached();
    // cfb:1 ends. The next poll moves its card to Final, but the list waits out LIST_REFRESH_MS before redrawing.
    state.cfb = cfbGames().map((e) => e.id !== "1" ? e : { ...e,
      status: { ...e.status, type: { ...e.status.type, state: "post", name: "STATUS_FINAL", shortDetail: "Final" } } });
    await page.clock.runFor(10_000);
    await expect(page.locator('.board-group[data-section="post"] .card[data-key="cfb:1"]')).toBeAttached();
    await page.locator('#list .group-label[data-group="Final"] + .group-body [data-bulk="remove"]').click();
    await expect(page.locator("#board .card")).toHaveCount(0);
  });

  const actions = (page, group) => page.locator(`#list .group-label[data-group="${group}"] + .group-body .group-actions`);
  const picked = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("selected")).sort());

  test("regular visitors don't get the bulk buttons", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    await expect(page.locator("#list .group-label").first()).toBeAttached();
    await expect(page.locator("#list .group-actions")).toHaveCount(0);
  });

  test("Select all picks every game a section shows, and Remove all takes that state's picks back off", async ({ page }) => {
    await open(page, { query: "?admin", storage: { ...admin, selected: ["cfb:5"], pickerOpen: true } });
    await expect(actions(page, "Live").getByRole("button")).toHaveText(["Select all"]);  // no live games picked yet
    await actions(page, "Live").getByRole("button", { name: "Select all" }).click();
    expect(await picked(page)).toEqual(["cfb:1", "cfb:2", "cfb:3", "cfb:4", "cfb:5"]);
    await expect(page.locator('#list .group-label[data-group="Live"]')).toHaveCount(0);  // every live game is now under Selected
    await expect(page.locator("#board .live .card")).toHaveCount(4);
    // Upcoming still lists cfb:6, and since cfb:5 is picked it offers to remove it.
    await actions(page, "Upcoming").getByRole("button", { name: "Remove all" }).click();
    expect(await picked(page)).toEqual(["cfb:1", "cfb:2", "cfb:3", "cfb:4"]);
  });

  test("Selected's Remove all clears only the picks in the current view", async ({ page }) => {
    await open(page, { query: "?admin", storage: { ...admin, selected: ["cfb:1", "cfb:7", "nfl:101"], pickerOpen: true } });
    await expect(actions(page, "Selected").getByRole("button")).toHaveText(["Remove all"]);
    await actions(page, "Selected").getByRole("button", { name: "Remove all" }).click();
    expect(await picked(page)).toEqual(["nfl:101"]);  // the NFL tab isn't in view
    await expect(page.locator('#list .group-label[data-group="Selected"]')).toHaveCount(0);
    await expect(page.locator("#board .card")).toHaveCount(1);
  });
});

test.describe("admin login", () => {
  test("regular visitors never ask the admin Worker for anything", async ({ page }) => {
    const state = await open(page, { storage: { selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    expect(state.adminRequests).toBe(0);
    await expect.poll(() => state.hits).toBe(1);
  });

  test("?admin asks for the password in a masked field and keeps only a token", async ({ page }) => {
    const state = await open(page, { query: "?admin", storage: { selected: ["cfb:1"] } });
    const field = page.locator("#admin-login input#admin-password");
    await expect(field).toHaveAttribute("type", "password");
    await field.fill(ADMIN_KEY);
    await field.press("Enter");
    await expect(page.locator("#admin-login")).toHaveCount(0);
    await expect(page.locator("#list .group-actions").first()).toBeAttached();
    expect(new URL(page.url()).search).toBe("?admin");  // kept while logged in
    const saved = await page.evaluate(() => JSON.stringify(localStorage));
    expect(saved).toContain(ADMIN_TOKEN);
    expect(saved).not.toContain(ADMIN_KEY);
    await page.goto("/index.html?admin");  // no password needed from now on
    await expect(page.locator("#list .group-actions").first()).toBeAttached();
    await expect(page.locator("#admin-login")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(state.hits).toBe(0);
  });

  test("without ?admin a logged-in browser shows no admin features, but still isn't counted", async ({ page }) => {
    const state = await open(page, { storage: { ...admin, selected: ALL_CFB, pickerOpen: true } });
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect.poll(() => state.adminRequests).toBe(1);  // the login is checked
    await expect(page.locator("#list .group-actions")).toHaveCount(0);
    await page.locator("#settings").click();
    await expect(page.locator("#visits")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("adminToken"))).toContain("test-token");  // still logged in
    await page.waitForTimeout(500);
    expect(state.hits).toBe(0);
  });

  test("a wrong password says so and asks again; cancelling leaves a regular page, counted", async ({ page }) => {
    const state = await open(page, { query: "?admin", storage: { selected: ["cfb:1"] } });
    await page.locator("#admin-password").fill("guess");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#admin-login .error")).toHaveText("Wrong password");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect(page.locator("#list .group-actions")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("adminToken"))).toBeNull();
    await expect.poll(() => new URL(page.url()).search).toBe("");  // not logged in, so ?admin goes
    await expect.poll(() => state.hits).toBe(1);
  });

  test("an expired token is forgotten without a fuss", async ({ page }) => {
    const state = await open(page, { storage: { adminToken: "1.expired", selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect(page.locator("#list .group-actions")).toHaveCount(0);
    await expect(page.locator("#admin-login")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("adminToken"))).toBe("null");
    await expect.poll(() => state.hits).toBe(1);
  });

  test("a password saved by an older version is swapped for a token and forgotten", async ({ page }) => {
    await open(page, { query: "?admin", storage: { adminKey: ADMIN_KEY, selected: ["cfb:1"] } });
    await expect(page.locator("#list .group-actions").first()).toBeAttached();
    const saved = await page.evaluate(() => JSON.stringify(localStorage));
    expect(saved).toContain(ADMIN_TOKEN);
    expect(saved).not.toContain(ADMIN_KEY);
  });

  test("?admin doesn't ask for the password when this browser is already logged in", async ({ page }) => {
    await open(page, { query: "?admin", storage: { ...admin, selected: ["cfb:1"] } });
    await expect(page.locator("#list .group-actions").first()).toBeAttached();
    await expect(page.locator("#admin-login")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("?admin");
  });

  test("?admin asks again once the saved login has expired", async ({ page }) => {
    await open(page, { query: "?admin", storage: { adminToken: "1.expired", selected: ["cfb:1"] } });
    await page.locator("#admin-password").fill(ADMIN_KEY);
    await page.locator("#admin-password").press("Enter");
    await expect(page.locator("#list .group-actions").first()).toBeAttached();
  });

  test("?admin=off logs out", async ({ page }) => {
    await open(page, { query: "?admin=off", storage: { ...admin, selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect(page.locator("#list .group-actions")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
  });

  test("the public code has no admin features in it", async ({ page }) => {
    await open(page);
    const sources = await page.evaluate(async () => Promise.all(performance.getEntriesByType("resource")
      .filter((r) => r.name.endsWith(".js")).map(async (r) => (await fetch(r.name)).text())));
    expect(sources.length).toBeGreaterThan(5);
    for (const src of sources) expect(src).not.toMatch(/data-bell|data-bulk/);
  });
});

test.describe("MDS", () => {
  const BLUE = { dark: "rgb(74, 134, 255)", light: "rgb(31, 107, 255)" };

  test("the gear menu's MDS colors the leading team's name and score blue in a grey box, remembered", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:4"] } });
    const away = card(page, "cfb:1").locator(".team.away"), home = card(page, "cfb:1").locator(".team.home");
    await expect(away.locator(".abbr")).not.toHaveCSS("color", BLUE.dark);
    await page.locator("#settings").click();
    await page.locator("#mds-blue").click();
    await expect(page.locator("#mds-blue")).toHaveAttribute("aria-pressed", "true");
    await expect(away.locator(".abbr")).toHaveCSS("color", BLUE.dark);
    await expect(away.locator(".pts")).toHaveCSS("color", BLUE.dark);
    await expect(home.locator(".abbr")).not.toHaveCSS("color", BLUE.dark);  // trailing
    await expect(away).toHaveCSS("outline-style", "solid");  // the grey box
    await expect(home).toHaveCSS("outline-style", "none");
    await expect(row(page, "cfb:1").locator(".bug-team").first()).toHaveCSS("outline-style", "solid");
    await expect(row(page, "cfb:1").locator(".bug-team").first().locator(".abbr")).toHaveCSS("color", BLUE.dark);
    await page.reload();
    await expect(card(page, "cfb:1").locator(".team.away .pts")).toHaveCSS("color", BLUE.dark);
    await page.locator("#settings").click();
    await page.locator("#mds-blue").click();
    await expect(card(page, "cfb:1").locator(".team.away .pts")).not.toHaveCSS("color", BLUE.dark);
  });

  test("a ?mds link no longer does anything special", async ({ page }) => {
    const loaded = [];
    page.on("request", (r) => /mds\.(js|css)/.test(r.url()) && loaded.push(r.url()));
    await open(page, { query: "?mds", storage: { selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    expect(loaded).toEqual([]);
    await expect(page.locator("#mds-blue")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#board .card")).toHaveCount(1);
  });
});

test.describe("game picker", () => {
  test("groups games into Live, Upcoming and Final with counts", async ({ page }) => {
    await open(page);
    await expect(page.locator("#list .group-label")).toHaveText([/Live\s*4/, /Upcoming\s*2/, /Final\s*2/]);
  });

  test("section headers look different from rows, and rows alternate shades", async ({ page }) => {
    await open(page);
    const header = await style(page.locator("#list .group-label").first(), "backgroundColor");
    const odd = await style(page.locator("#list label.game").nth(0), "backgroundColor");
    const even = await style(page.locator("#list label.game").nth(1), "backgroundColor");
    expect(odd).not.toBe(even);
    expect(header).not.toBe(odd);
    expect(header).not.toBe(even);
  });

  test("the + circle keeps its spot at the row's right edge, with room between it and the time", async ({ page }) => {
    await open(page);
    const r = await row(page, "cfb:5").boundingBox();
    const pick = await row(page, "cfb:5").locator(".pick").boundingBox();
    const status = await row(page, "cfb:5").locator(".bug-status").boundingBox();
    expect(r.x + r.width - (pick.x + pick.width)).toBeCloseTo(12, 0);  // row padding
    expect(pick.x - (status.x + status.width)).toBeGreaterThanOrEqual(22);
  });

  test("with a mouse, the + is hidden until its row is hovered, then brightens when pointed at", async ({ page }) => {
    await open(page);
    const plus = row(page, "cfb:5").locator(".pick");
    expect((await plus.boundingBox()).width).toBeCloseTo(22, 0);
    expect(await style(plus, "opacity")).toBe("0");
    await expect(plus).toHaveAttribute("title", "Add");
    await row(page, "cfb:5").locator(".bug").hover();
    await expect.poll(() => style(plus, "opacity")).toBe("0.5");
    await plus.hover();
    await expect.poll(() => style(plus, "opacity")).toBe("1");
    await plus.click();
    await expect(row(page, "cfb:5").locator("input")).toBeChecked();
  });

  test("with a mouse, picked rows show no mark until hovered, then a ✕ that removes the game", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    const mark = row(page, "cfb:1").locator(".pick");
    expect(await style(mark, "opacity")).toBe("0");
    await expect(mark).toHaveAttribute("title", "Remove");
    await row(page, "cfb:1").locator(".bug").hover();
    await expect.poll(() => style(mark, "opacity")).toBe("0.5");
    await mark.hover();
    await expect.poll(() => style(mark, "opacity")).toBe("1");
    await mark.click();
    await expect(row(page, "cfb:1").locator("input")).not.toBeChecked();
    await expect(card(page, "cfb:1")).toHaveCount(0);
  });

  test("the Live section stands out: tinted header, pulsing dot, red edge on live rows", async ({ page }) => {
    await open(page);
    const live = page.locator('#list .group-label[data-group="Live"]');
    const upcoming = page.locator('#list .group-label[data-group="Upcoming"]');
    expect(await style(live, "backgroundColor")).not.toBe(await style(upcoming, "backgroundColor"));
    expect(await live.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("live-pulse");
    await expect(row(page, "cfb:1")).toHaveClass(/live/);
    await expect(row(page, "cfb:5")).not.toHaveClass(/live/);
    expect(await style(row(page, "cfb:1"), "boxShadow")).toContain("inset");
  });

  test("rows read like a score bug: both teams, scores, status, loser greyed out", async ({ page }) => {
    await open(page);
    const final = row(page, "cfb:7");
    await expect(final.locator(".bug-team")).toHaveCount(2);
    await expect(final.locator(".bug-team").nth(0)).toContainText("ALA");
    await expect(final.locator(".bug-team").nth(0)).toContainText("56");
    await expect(final.locator(".bug-team").nth(1)).toHaveClass(/lost/);
    await expect(final.locator(".bug-status")).toContainText("Final");
    await expect(row(page, "cfb:1").locator(".rank").first()).toHaveText("5");
    await expect(row(page, "cfb:1").locator(".rec")).toHaveText(["5-0", "3-2"]);  // team records
  });

  test("the leading team is marked on cards and rows (a tie or a game not started marks neither), but underlined only with MDS on", async ({ page }) => {
    const cfb = cfbGames();
    cfb.find((e) => e.id === "4").competitions[0].competitors.forEach((c) => { c.score = "14"; });  // BYU–TCU tied
    await open(page, { cfb, storage: { selected: ["cfb:1", "cfb:2", "cfb:4", "cfb:5", "cfb:7"] } });
    const leaders = (loc) => loc.locator(".pts").evaluateAll((pts) => pts.map((p) => p.classList.contains("lead")));
    for (const at of [(key) => card(page, key), (key) => row(page, key)]) {
      expect(await leaders(at("cfb:1"))).toEqual([true, false]);  // away leads, live
      expect(await leaders(at("cfb:2"))).toEqual([false, true]);  // home leads
      expect(await leaders(at("cfb:7"))).toEqual([true, false]);  // final
      expect(await leaders(at("cfb:4"))).toEqual([false, false]);  // tied
      expect(await leaders(at("cfb:5"))).toEqual([false, false]);  // not started
    }
    await expect(card(page, "cfb:1").locator(".pts.lead")).toHaveCSS("text-decoration-line", "none");
    await expect(row(page, "cfb:1").locator(".pts.lead")).toHaveCSS("text-decoration-line", "none");
    await page.locator("#settings").click();
    await page.locator("#mds-blue").click();
    await expect(card(page, "cfb:1").locator(".pts.lead")).toHaveCSS("text-decoration-line", "underline");
    await expect(row(page, "cfb:1").locator(".pts.lead")).toHaveCSS("text-decoration-line", "underline");
  });

  test("clicking a row adds the game; Selected section lists picks in the original list order", async ({ page }) => {
    await open(page);
    await row(page, "cfb:8").locator(".bug").click();  // a final game first...
    await row(page, "cfb:1").locator(".bug").click();  // ...then a live one
    expect(await rowKeys(page, "Selected")).toEqual(["cfb:1", "cfb:8"]);  // live sorts before final, as in the full list
    await expect(card(page, "cfb:1")).toBeVisible();
    await expect(card(page, "cfb:8")).toBeVisible();
  });

  test("picks persist across reloads", async ({ page }) => {
    await open(page);
    await row(page, "cfb:2").locator(".bug").click();
    await page.reload();
    await expect(row(page, "cfb:2").locator("input")).toBeChecked();
    await expect(card(page, "cfb:2")).toBeVisible();
  });

  test("a newly picked row slides into the Selected section", async ({ page }) => {
    await open(page);
    await row(page, "cfb:5").locator(".bug").click();
    await expect.poll(() => row(page, "cfb:5").evaluate((el) => el.style.transition), { timeout: 1000, intervals: [10] })
      .toContain("transform");
  });

  test("clicking a selected row highlights its card instead of unselecting; the ✓ unselects", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    await row(page, "cfb:1").locator(".bug").click();
    await expect(row(page, "cfb:1").locator("input")).toBeChecked();
    await expect(card(page, "cfb:1")).toHaveClass(/flash/);
    await row(page, "cfb:1").locator(".pick").click();
    await expect(row(page, "cfb:1").locator("input")).not.toBeChecked();
    await expect(card(page, "cfb:1")).toHaveCount(0);
  });

  test("sections collapse and stay collapsed after reload", async ({ page }) => {
    await open(page);
    const live = page.locator('#list .group-label[data-group="Live"]');
    await live.click();
    await expect(live).toHaveAttribute("aria-expanded", "false");
    await expect(live.locator("+ .group-body")).toHaveClass(/collapsed/);
    await page.reload();
    await expect(page.locator('#list .group-label[data-group="Live"]')).toHaveAttribute("aria-expanded", "false");
  });

  test("returning to the tab fetches right away and restarts the 10-second timer", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page);
    await expect.poll(() => state.espnRequests).toBe(2);  // NFL + college on load
    await page.clock.runFor(8_000);
    expect(state.espnRequests).toBe(2);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => state.espnRequests).toBe(4);  // immediately, not at the 10s mark
    await page.clock.runFor(8_000);
    expect(state.espnRequests).toBe(4);  // timer restarted, so nothing at the old 10s mark
    await page.clock.runFor(2_000);
    await expect.poll(() => state.espnRequests).toBe(6);
  });

  test("an empty answer from ESPN keeps the games already showing", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { storage: { selected: ["cfb:2"] } });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    state.cfb = [];
    await page.clock.runFor(40_000);  // several polls, past the list's 30-second refresh
    await expect(card(page, "cfb:2")).toBeVisible();
    await expect(row(page, "cfb:7")).toBeVisible();
    await expect.poll(() => errors.join()).toContain("ESPN sent no games");  // the poll's answer can land after runFor returns
  });

  test("the list refreshes every 30 seconds while cards refresh every 10", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { storage: { selected: ["cfb:2"] } });
    await expect(row(page, "cfb:2").locator(".bug-status")).toContainText("6:06");
    state.cfb = cfbGames().map((g) => (g.id === "2" ? { ...g, status: { ...g.status, displayClock: "5:30" } } : g));
    await page.clock.runFor(10_000);
    await expect(card(page, "cfb:2").locator(".clock")).toContainText("5:30");
    await expect(row(page, "cfb:2").locator(".bug-status")).toContainText("6:06");  // list not refreshed yet
    await page.clock.runFor(20_000);
    await expect(row(page, "cfb:2").locator(".bug-status")).toContainText("5:30");
  });
});

test.describe("filters", () => {
  const menu = (page) => page.locator("#conf-menu");
  const choices = (page) => menu(page).locator("label").allTextContents();
  // Open the conference checklist (if closed) and tick or untick one choice.
  async function toggleConf(page, label) {
    if (await menu(page).isHidden()) await page.locator("#conf").click();
    await menu(page).locator("label", { hasText: new RegExp(`^${label}$`) }).click();
  }

  test("filters are visible on both tabs; Top 25 is college-only", async ({ page }) => {
    await open(page);
    await expect(page.locator("#conf")).toBeVisible();
    await expect(page.locator("#top25")).toBeVisible();
    await page.locator('.tabs button[data-league="nfl"]').click();
    await expect(page.locator("#conf")).toBeVisible();
    await expect(page.locator("#top25")).toBeHidden();
  });

  test("conference checklist lists named conferences; picking several shows games from any of them", async ({ page }) => {
    await open(page);
    await expect(page.locator("#conf")).toHaveText("All conferences");
    await page.locator("#conf").click();
    expect(await choices(page)).toEqual(["Big 12", "Big Ten", "Independent", "SEC"]);
    await toggleConf(page, "SEC");
    await expect(page.locator("#list label.game")).toHaveCount(2);  // VAN @ UGA, ALA @ MSST
    await expect(page.locator("#conf")).toHaveText("SEC");
    await toggleConf(page, "Big Ten");
    await expect(page.locator("#list label.game")).toHaveCount(4);  // plus OSU @ IOWA, MD @ PUR
    await expect(page.locator("#conf")).toHaveText("Big Ten, SEC");
    await toggleConf(page, "Big 12");
    await expect(page.locator("#conf")).toHaveText("3 conferences");
    await expect(menu(page)).toBeVisible();  // stays open while ticking
  });

  test("✕ clears every chosen conference at once", async ({ page }) => {
    await open(page);
    await toggleConf(page, "SEC");
    await toggleConf(page, "Big Ten");
    await page.locator("#conf-clear").click();
    await expect(page.locator("#list label.game")).toHaveCount(8);
    await expect(page.locator("#conf")).toHaveText("All conferences");
    await expect(page.locator("#conf-clear")).toBeHidden();
  });

  test("checklist closes on an outside click or Escape", async ({ page }) => {
    await open(page);
    await page.locator("#conf").click();
    await expect(menu(page)).toBeVisible();
    await page.locator("header h1").click();
    await expect(menu(page)).toBeHidden();
    await page.locator("#conf").click();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
  });

  test("NFL checklist offers AFC, NFC and their divisions, in any combination", async ({ page }) => {
    await open(page, { storage: { tab: "nfl" } });
    await page.locator("#conf").click();
    expect(await choices(page)).toEqual([
      "All AFC", "AFC East", "AFC North", "AFC South", "AFC West",
      "All NFC", "NFC East", "NFC North", "NFC South", "NFC West"]);
    await toggleConf(page, "All NFC");
    await expect(page.locator("#list label.game")).toHaveCount(1);
    await expect(row(page, "nfl:102")).toBeAttached();  // DAL @ PHI
    await expect(page.locator("#conf")).toHaveText("NFC");
    await toggleConf(page, "AFC East");
    await expect(page.locator("#list label.game")).toHaveCount(2);  // plus NE @ NYJ
    await toggleConf(page, "All NFC");
    await toggleConf(page, "AFC East");
    await toggleConf(page, "AFC North");
    await expect(page.locator("#list .empty")).toHaveText("No matching games.");
  });

  test("each league remembers its own choices", async ({ page }) => {
    await open(page);
    await toggleConf(page, "SEC");
    await page.locator('.tabs button[data-league="nfl"]').click();
    await expect(page.locator("#conf")).toHaveText("All conferences");
    await toggleConf(page, "All AFC");
    await page.reload();
    await expect(page.locator("#conf")).toHaveText("AFC");
    await page.locator('.tabs button[data-league="cfb"]').click();
    await expect(page.locator("#conf")).toHaveText("SEC");
  });

  test("filters saved in older formats still apply", async ({ page }) => {
    await open(page, { storage: { filters: { conf: "8", top25: false } } });  // college-only, single conference
    await expect(page.locator("#conf")).toHaveText("SEC");
    await expect(page.locator("#list label.game")).toHaveCount(2);
  });

  test("filters saved per league with a single conference still apply", async ({ page }) => {
    await open(page, { storage: { tab: "nfl", filters: { cfb: { conf: "", top25: true }, nfl: { conf: "AFC" } } } });
    await expect(page.locator("#conf")).toHaveText("AFC");
    await page.locator('.tabs button[data-league="cfb"]').click();
    await expect(page.locator("#list label.game")).toHaveCount(5);  // Top 25 carried over
  });

  test("dropdown arrow sits well inside the right edge", async ({ page }) => {
    await open(page);
    expect(await style(page.locator("#conf"), "backgroundPosition")).toContain("12px");
  });

  test("Top 25 shows only games with a ranked team and is remembered", async ({ page }) => {
    await open(page);
    await page.locator("#top25").click();
    await expect(page.locator("#list label.game")).toHaveCount(5);
    await page.reload();
    await expect(page.locator("#top25")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#list label.game")).toHaveCount(5);
  });

  test("Top 25 filters the list but keeps it in kickoff order", async ({ page }) => {
    await open(page);
    expect(await rowKeys(page, "Final")).toEqual(["cfb:7", "cfb:8"]);  // same kickoff; list order
    await page.locator("#top25").click();
    await expect(page.locator("#list label.game")).toHaveCount(5);
    expect(await rowKeys(page, "Final")).toEqual(["cfb:7", "cfb:8"]);  // #7 Alabama stays ahead of #3 Notre Dame
  });

  test("Top 25 doesn't reorder the board", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:5", "cfb:6", "cfb:7", "cfb:8", "nfl:102"] } });
    const keys = (st) => page.locator(`.board-group[data-section="${st}"] .card`).evaluateAll((cs) => cs.map((c) => c.dataset.key));
    expect(await keys("post")).toEqual(["cfb:7", "cfb:8"]);
    await page.locator("#top25").click();
    await expect(page.locator("#list label.game")).toHaveCount(5);
    expect(await keys("post")).toEqual(["cfb:7", "cfb:8"]);
    expect(await keys("pre")).toEqual(["cfb:5", "cfb:6", "nfl:102"]);
  });
});

test.describe("game cards", () => {
  test("live card shows score, clock, down and distance and possession, but no timeouts", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    const c = card(page, "cfb:1");
    await expect(c.locator(".dd")).toHaveText("3rd & 6 at IOWA 12");
    await expect(c.locator(".clock")).toHaveText(/2:00\s*4th/);
    await expect(c.locator(".team.away .pts")).toHaveText("24");
    await expect(c.locator(".team.away .poss")).not.toHaveClass(/hide/);
    await expect(c.locator(".team.home .poss")).toHaveClass(/hide/);
    await expect(c.locator(".to")).toHaveCount(0);  // ESPN sends them, but its college counts are unreliable
    await expect(c.locator(".team.away .rank")).toHaveText("5");
  });

  test("cards show each team's overall record under its name", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:8"] } });
    await expect(card(page, "cfb:1").locator(".team.away .rec")).toHaveText("5-0");
    await expect(card(page, "cfb:1").locator(".team.home .rec")).toHaveText("3-2");
    await expect(card(page, "cfb:8").locator(".team.away .rec")).toHaveText("");  // ESPN sent no record
  });

  test("field shows the ball, line of scrimmage, line to gain and direction", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    const svg = card(page, "cfb:1").locator("svg.field");
    // IOWA 12 is 12 yards from the home goal; the field is 120 units with the away end zone at 0–10.
    await expect(svg.locator(".ball")).toHaveAttribute("data-x", "98");
    await expect(svg.locator('line[stroke="var(--ltg)"]')).toHaveAttribute("x1", "104");  // 6 yards toward the home end zone
    const tip = Number((await svg.locator("polygon").getAttribute("points")).split(",")[0]);
    expect(tip).toBeGreaterThan(98);  // arrow points right, toward the home end zone
  });

  test("red-zone card has a red outline and glows once, again on returning to the tab", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:8"] } });
    const c = card(page, "cfb:1");
    await expect(c).toHaveClass(/redzone/);
    await expect(c).toHaveClass(/glow/);
    await expect(card(page, "cfb:8")).not.toHaveClass(/redzone/);
    await page.waitForTimeout(2500);
    await c.locator(".last").click();  // opening and closing the last play re-renders the board
    await page.keyboard.press("Escape");
    await expect(c).not.toHaveClass(/glow/);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(c).toHaveClass(/glow/);
  });

  test("red zone comes from the ball's position, not ESPN's sometimes-stale flag", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:2", "cfb:3", "nfl:101"] } });
    await expect(card(page, "cfb:1")).toHaveClass(/redzone/);      // away team at the home 12
    await expect(card(page, "cfb:3")).not.toHaveClass(/redzone/);  // ESPN says red zone, but nobody has the ball
    await expect(card(page, "cfb:2")).not.toHaveClass(/redzone/);  // own 25
    await expect(card(page, "nfl:101")).not.toHaveClass(/redzone/);  // own 40
  });

  test("no written spot, no red zone, whatever yardLine and ESPN's flag say", async ({ page }) => {
    // Seen live right after a sack: Alabama "on the goal line", yardLine 0 and isRedZone true, but no down & distance.
    const cfb = cfbGames().map((e) => e.id !== "1" ? e : { ...e, competitions: [{ ...e.competitions[0],
      situation: { ...e.competitions[0].situation, yardLine: 0, downDistanceText: undefined, possessionText: undefined, isRedZone: true } }] });
    await open(page, { cfb, storage: { selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect(card(page, "cfb:1")).not.toHaveClass(/redzone/);
  });

  test("the written spot wins over a stale yardLine: a team at its own 20 isn't in the red zone", async ({ page }) => {
    // Seen live right after a punt: ESPN's yardLine still put OSU 12 yards from the goal while the spot read OSU 20.
    const cfb = cfbGames().map((e) => e.id !== "1" ? e : { ...e, competitions: [{ ...e.competitions[0],
      situation: { ...e.competitions[0].situation, downDistanceText: "1st & 10 at OSU 20", isRedZone: false } }] });
    await open(page, { cfb, storage: { selected: ["cfb:1"] } });
    await expect(card(page, "cfb:1")).toBeAttached();
    await expect(card(page, "cfb:1")).not.toHaveClass(/redzone/);
  });

  test("possession falls back to the last play after a kickoff, but not after a timeout", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:2", "cfb:3"] } });
    await expect(card(page, "cfb:2").locator(".team.away .poss")).not.toHaveClass(/hide/);
    await expect(card(page, "cfb:3").locator(".poss:not(.hide)")).toHaveCount(0);
  });

  test("halftime shows Half with no stale down, distance or ball", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:4"] } });
    const c = card(page, "cfb:4");
    await expect(c.locator(".clock")).toHaveText(/^Half/);
    await expect(c.locator(".dd")).toHaveText(/^\s*$/);
    await expect(c.locator(".ball")).toHaveCount(0);
  });

  test("upcoming shows kickoff time and day; final shows Final", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:5", "cfb:7"] } });
    await expect(card(page, "cfb:5").locator(".clock")).toHaveText(/\d{1,2}:\d{2}\s?[AP]M\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/);
    await expect(card(page, "cfb:7").locator(".clock")).toHaveText(/^Final/);
  });

  test("cards side by side line up regardless of game state", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:4"] } });  // red zone with a ball vs. halftime with none
    const a = await card(page, "cfb:1").locator("svg.field").boundingBox();
    const b = await card(page, "cfb:4").locator("svg.field").boundingBox();
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.height - b.height)).toBeLessThan(1);
  });

  test("last play opens in full over the card without changing the layout", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    const c = card(page, "cfb:1");
    const before = await c.boundingBox();
    await expect(c.locator(".last")).toHaveAttribute("title", LONG_PLAY);
    await c.locator(".last").click();
    await expect(c.locator(".last-full")).toHaveText(LONG_PLAY);
    expect((await c.boundingBox()).height).toBe(before.height);
    await c.locator(".last-full").click();
    await expect(c.locator(".last-full")).toHaveCount(0);
    await c.locator(".last").click();
    await page.keyboard.press("Escape");
    await expect(c.locator(".last-full")).toHaveCount(0);
    await c.locator(".last").click();
    await page.locator("header h1").click();
    await expect(c.locator(".last-full")).toHaveCount(0);
  });

  test("each card notes its network at the bottom, and omits it when ESPN has none", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:7", "cfb:5"] } });
    await expect(card(page, "cfb:1").locator(".card-foot .net")).toHaveText("FOX");
    await expect(card(page, "cfb:7").locator(".card-foot .net")).toHaveText("CBS / Paramount+");
    await expect(card(page, "cfb:5").locator(".net")).toHaveCount(0);
    expect(await style(card(page, "cfb:1").locator(".net"), "color")).toBe("rgb(255, 255, 255)");
  });

  test("✕ appears on hover, removes the card and unchecks the row", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    const remove = card(page, "cfb:1").locator(".remove");
    expect(await style(remove, "opacity")).toBe("0");
    await card(page, "cfb:1").hover();
    await expect.poll(() => style(remove, "opacity")).toBe("1");
    expect(await style(remove, "backgroundColor")).toBe("rgb(154, 160, 166)");
    expect(await style(remove, "color")).toBe("rgb(0, 0, 0)");
    await remove.click();
    await expect(card(page, "cfb:1")).toHaveCount(0);
    await expect(row(page, "cfb:1").locator("input")).not.toBeChecked();
  });

  test("logos use ESPN's dark-background versions with a light edge, falling back if missing", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] }, missingLogo: "500-dark/2294" });
    const away = card(page, "cfb:1").locator(".team.away img");
    await expect(away).toHaveAttribute("src", /\/500-dark\/194\.png$/);
    expect(await style(away, "filter")).toContain("drop-shadow");
    await expect(card(page, "cfb:1").locator(".team.home img")).toHaveAttribute("src", /\/500\/2294\.png$/);
  });
});

test.describe("board", () => {
  test("shows every selected game from both leagues, live first", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:8", "nfl:101", "cfb:1"] } });
    const keys = await page.locator(".card").evaluateAll((cards) => cards.map((c) => c.dataset.key));
    expect(keys.slice(0, 2).sort()).toEqual(["cfb:1", "nfl:101"]);
    expect(keys[2]).toBe("cfb:8");
  });

  test("cards are grouped into Live, Final and Upcoming sections, in that order", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:7", "cfb:5", "cfb:1", "nfl:101"] } });
    const order = await page.locator("#board .card, #board .board-section").evaluateAll((els) =>
      els.map((el) => el.dataset.key ?? el.textContent));
    expect(order.slice(0, 1)).toEqual(["Live"]);
    expect(order.slice(1, 3).sort()).toEqual(["cfb:1", "nfl:101"]);
    expect(order.slice(3)).toEqual(["Final", "cfb:7", "Upcoming", "cfb:5"]);
  });

  test("final and upcoming cards share a narrower layout with no field; live cards keep theirs", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:7", "cfb:5", "cfb:1"] } });
    for (const key of ["cfb:7", "cfb:5"]) {
      await expect(card(page, key).locator("svg.field")).toHaveCount(0);
      await expect(card(page, key).locator(".dd")).toHaveCount(0);
    }
    await expect(card(page, "cfb:1").locator("svg.field")).toHaveCount(1);
    const width = async (key) => (await card(page, key).boundingBox()).width;
    expect(await width("cfb:7")).toBe(await width("cfb:5"));
    expect(await width("cfb:7")).toBeLessThan(await width("cfb:1"));
  });

  test("cards share each section's full width, with the column count set by the board's width", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:2", "cfb:7", "cfb:5", "cfb:6", "cfb:8"] } });
    // The columns fill the section exactly: no leftover space at the end of a row.
    const fill = (sel) => page.locator(sel).first().evaluate((el) => {
      const s = getComputedStyle(el), tracks = s.gridTemplateColumns.split(" ").map(parseFloat);
      return Math.abs(tracks.reduce((a, b) => a + b) + (tracks.length - 1) * parseFloat(s.columnGap) - el.clientWidth);
    });
    for (const width of [760, 1000, 1300, 1900]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await fill(".live .cards")).toBeLessThan(1);
      expect(await fill(".compact .cards")).toBeLessThan(1);
      expect((await card(page, "cfb:1").boundingBox()).width).toBeGreaterThanOrEqual(340);
      const compact = (await card(page, "cfb:7").boundingBox()).width;
      expect(compact).toBeGreaterThan(220);
      expect(compact).toBeLessThan(460);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    // At 1300px the board (about 970px) has two live columns and three compact ones.
    await page.setViewportSize({ width: 1300, height: 900 });
    const cols = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(await cols(".live .cards")).toBe(2);
    expect(await cols(".compact .cards")).toBe(3);
  });

  test("team names fit on the narrow Final and Upcoming cards", async ({ page }) => {
    await open(page, { storage: { selected: [...ALL_CFB, "nfl:101", "nfl:102"] } });
    await expect(card(page, "cfb:7")).toBeVisible();
    const clipped = await page.locator(".compact .card .name").evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
    expect(clipped).toEqual([]);
  });

  test("a section only appears when it has games", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    await expect(page.locator(".board-section")).toHaveText(["Live"]);
  });

  test("final cards link to ESPN's recap in a new tab once the story exists", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:7", "cfb:8", "cfb:1"] }, recaps: ["7", "8"] });
    const recap = card(page, "cfb:7").locator("a.recap");
    await expect(recap).toHaveAttribute("href", "https://www.espn.com/college-football/recap/_/gameId/7");  // the scoreboard's link
    await expect(recap).toHaveAttribute("target", "_blank");
    // No recap link on the scoreboard: falls back to the article's own link, made https.
    await expect(card(page, "cfb:8").locator("a.recap")).toHaveAttribute("href", "https://www.espn.com/ncf/recap?gameId=8");
    await expect(card(page, "cfb:1").locator("a.recap")).toHaveCount(0);
  });

  test("no recap link while the recap isn't written; it appears on a later check", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { storage: { selected: ["cfb:7"] }, recaps: [] });
    await expect.poll(() => state.summaryRequests["7"]).toBe(1);
    await expect(card(page, "cfb:7").locator("a.recap")).toHaveCount(0);
    state.recaps.add("7");
    await page.clock.runFor(60_000);
    expect(state.summaryRequests["7"]).toBe(1);  // checks every 2 minutes, not on every 10-second poll
    await page.clock.runFor(60_000);
    await expect(card(page, "cfb:7").locator("a.recap")).toHaveCount(1);
    await page.clock.runFor(10 * 60_000);
    expect(state.summaryRequests["7"]).toBe(2);  // found it, so it stops checking
  });

  test("stops checking for a recap after an hour", async ({ page }) => {
    // Paused, so the page's time moves only when the test moves it and every check lands exactly on schedule.
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-03T20:00:01Z"));
    const state = await open(page, { storage: { selected: ["cfb:7"] }, recaps: [] });
    await expect.poll(() => state.summaryRequests["7"]).toBe(1);
    for (let n = 2; n <= 31; n++) {  // every 2 minutes through the hour
      await page.clock.runFor(2 * 60_000);
      await expect.poll(() => state.summaryRequests["7"]).toBe(n);
    }
    await page.clock.runFor(30 * 60_000);
    expect(state.summaryRequests["7"]).toBe(31);
  });

  test("with no picks, it says where to pick games", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    await card(page, "cfb:1").hover();
    await card(page, "cfb:1").locator(".remove").click();
    await expect(page.locator("#board .empty .desktop-only")).toHaveText("Pick a few games from the list on the left and they'll show up here.");
    await expect(page.locator("#board .empty .mobile-only")).toBeHidden();
  });
});

test.describe("header football", () => {
  test("leads the wordmark, sits still, and spirals once when clicked", async ({ page }) => {
    await open(page);
    const logo = page.locator("#logo");
    const title = await page.locator("header h1").boundingBox(), box = await logo.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(title.x);
    expect(title.x - (box.x + box.width)).toBeLessThan(16);
    expect(await style(logo.locator(".laces"), "animationName")).toBe("none");
    await logo.click();
    expect(await style(logo.locator(".laces"), "animationName")).toBe("spiral-once");
    await expect(logo).not.toHaveClass(/spiral/);  // done after one turn
    expect(await style(logo.locator(".laces"), "animationName")).toBe("none");
  });
});

test.describe("wordmark", () => {
  test("GAME over TRACKER in the self-hosted condensed face, read as one name", async ({ page }) => {
    await open(page);
    const h1 = page.locator("header h1");
    await expect(h1).toHaveText(/^Game Tracker Live$/);
    const game = await h1.locator(".l1").boundingBox(), tracker = await h1.locator(".l2").boundingBox();
    expect(game.y + game.height).toBeLessThanOrEqual(tracker.y + 1);  // stacked
    expect(await page.evaluate(() => document.fonts.check('700 18px "Barlow Condensed"'))).toBe(true);
    expect(await page.evaluate(async () => (await document.fonts.ready, [...document.fonts].some((f) => f.family.includes("Barlow") && f.status === "loaded")))).toBe(true);
  });
});

test.describe("?loading", () => {
  test("never fetches games, so the spinners stay up, and skips the hit counter", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    const state = await open(page, { query: "?loading", gate: new Promise(() => {}) });
    await expect(page.locator("#list .spinner")).toBeVisible();
    await expect(page.locator("#board .spinner")).toBeVisible();
    await page.clock.runFor(30_000);
    await expect(page.locator(".spinner")).toHaveCount(2);
    expect(state.espnRequests).toBe(0);
    expect(state.hits).toBe(0);
  });
});

test.describe("counter, and a game that kicks off", () => {
  test("a picked game that kicks off grows from Upcoming into Live", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-03T20:00:00Z") });
    // Record card animations as they start; they're too quick to catch reliably by polling getAnimations().
    await page.addInitScript(() => {
      window.cardAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains("card")) window.cardAnimations.push({ key: this.dataset.key, keyframes });
        return animate.call(this, keyframes, options);
      };
    });
    const state = await open(page, { storage: { selected: ["cfb:1", "cfb:5"] } });
    const kickoff = card(page, "cfb:5");
    await expect(page.locator('.board-group[data-section="pre"] .card[data-key="cfb:5"]')).toBeVisible();
    await expect(kickoff.locator("svg.field")).toHaveCount(0);
    await page.clock.runFor(10_000);
    expect(await page.evaluate(() => window.cardAnimations.length)).toBe(0);  // nothing moves on ordinary refreshes
    // Vanderbilt at Georgia kicks off: Vanderbilt ball at its own 25.
    state.cfb = cfbGames().map((e) => e.id !== "5" ? e : { ...e,
      status: { ...e.status, displayClock: "15:00", type: { ...e.status.type, state: "in", name: "STATUS_IN_PROGRESS", shortDetail: "15:00 - 1st" } },
      competitions: [{ ...e.competitions[0], situation: { possession: "238", yardLine: 75, downDistanceText: "1st & 10 at VAN 25", distance: 10 } }] });
    await page.clock.runFor(10_000);
    await expect(page.locator('.board-group[data-section="in"] .card[data-key="cfb:5"]')).toBeVisible();
    await expect(kickoff.locator(".dd")).toHaveText("1st & 10 at VAN 25");
    await expect(kickoff.locator("svg.field")).toHaveCount(1);
    const grow = (await page.evaluate(() => window.cardAnimations)).find((a) => a.key === "cfb:5");
    expect(parseFloat(grow.keyframes[0].height)).toBeLessThan(parseFloat(grow.keyframes[1].height));
    expect(parseFloat(grow.keyframes[0].width)).toBeLessThan(parseFloat(grow.keyframes[1].width));
  });

  test("the admin isn't counted", async ({ page }) => {
    const state = await open(page, { query: "?admin", storage: admin });
    await expect(page.locator("#list label.game")).toHaveCount(8);
    await page.waitForTimeout(500);
    expect(state.hits).toBe(0);
  });


  test("without ?admin, the hidden hit counter is requested once and isn't on the page", async ({ page }) => {
    const state = await open(page);
    await expect.poll(() => state.hits).toBe(1);
    await expect(page.locator('img[src*="hits.sh"]')).toHaveCount(0);
  });
});

test.describe("settings gear and google me", () => {
  test("gear menu animates open with Save board as image, google me and MDS, and closes on Escape or outside click", async ({ page }) => {
    await open(page);
    const menu = page.locator("#settings-menu");
    await expect(menu).toBeHidden();
    await page.locator("#settings").click();
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((m) => m.getAnimations().length)).toBeGreaterThan(0);
    await expect(menu.locator("button:visible")).toHaveText(["Save board as image", "✓google me", "✓MDS"]);  // the view and theme copies are for phones
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.locator("#settings").click();
    await page.locator("header h1").click();
    await expect(menu).toBeHidden();
  });

  test("google me grows Cignetti out of the button, shows a check, and clicking him dismisses him", async ({ page }) => {
    await open(page);
    const coach = page.locator("#coach");
    await page.locator("#settings").click();
    await page.locator("#google-me").click();
    await expect(coach).toBeVisible();
    expect(await coach.evaluate((c) => c.getAnimations().length)).toBeGreaterThan(0);
    await expect(page.locator("#google-me")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#settings-menu")).toBeVisible();  // stays open for another click
    await expect(coach.locator("figcaption")).toHaveCount(0);
    await page.waitForTimeout(600);
    await coach.click();
    await expect(coach).toBeHidden();
    await expect(page.locator("#google-me")).toHaveAttribute("aria-pressed", "false");
  });

  test("google me again shrinks him away", async ({ page }) => {
    await open(page);
    await page.locator("#settings").click();
    await page.locator("#google-me").click();
    await expect(page.locator("#coach")).toBeVisible();
    await page.waitForTimeout(600);
    await page.locator("#google-me").click();  // the menu is still open
    await expect(page.locator("#coach")).toBeHidden();
    await expect(page.locator("#settings-menu")).toBeVisible();
  });
});

test.describe("google me: Cignetti, or Pelini one time in ten", () => {
  const showCoach = async (page) => {
    await page.locator("#settings").click();
    await page.locator("#google-me").click();
    await expect(page.locator("#coach")).toBeVisible();
    return page.locator("#coach img").getAttribute("src");
  };
  const stubRandom = (page, value) => page.addInitScript((v) => { Math.random = () => v; }, value);

  test("Cignetti on rolls of 0.1 and up", async ({ page }) => {
    await stubRandom(page, 0.1);
    await open(page);
    expect(await showCoach(page)).toBe("images/cignetti.png");
  });

  test("Pelini on rolls under 0.1", async ({ page }) => {
    await stubRandom(page, 0.09);
    await open(page);
    expect(await showCoach(page)).toBe("images/pelini.png");
  });

  test("after a swap, the previous coach never shows, even for a frame", async ({ page }) => {
    // First showing rolls Pelini, second rolls Cignetti.
    await page.addInitScript(() => { const rolls = [0.05, 0.5]; Math.random = () => rolls.shift() ?? 0.5; });
    await open(page);
    // Record which photo is in place, and whether it has loaded, the instant the coach is revealed.
    await page.evaluate(() => {
      window.reveals = [];
      const coach = document.getElementById("coach"), img = coach.querySelector("img");
      new MutationObserver(() => { if (!coach.hidden) window.reveals.push({ src: img.getAttribute("src"), ready: img.complete && img.naturalWidth > 0 }); })
        .observe(coach, { attributes: true, attributeFilter: ["hidden"] });
    });
    for (let i = 0; i < 2; i++) {
      await page.locator("#settings").click();
      await page.locator("#google-me").click();
      await expect(page.locator("#coach")).toBeVisible();
      await page.waitForTimeout(600);
      await page.locator("#coach").click();
      await expect(page.locator("#coach")).toBeHidden();
    }
    expect(await page.evaluate(() => window.reveals)).toEqual([
      { src: "images/pelini.png", ready: true },
      { src: "images/cignetti.png", ready: true },
    ]);
  });

  test("being the admin doesn't change the odds", async ({ page }) => {
    await stubRandom(page, 0.5);
    await open(page, { query: "?admin", storage: admin });
    expect(await showCoach(page)).toBe("images/cignetti.png");
  });
});

test.describe("light and dark themes", () => {
  const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);

  test("follows a dark device by default, with dark-background logos and the light logo edge", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    expect(await theme(page)).toBe("dark");
    await expect(card(page, "cfb:1").locator(".team.away img")).toHaveAttribute("src", /\/500-dark\/194\.png$/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  });

  test("the switch flips to light: light colors, regular logos, no logo edge, and it's remembered", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-label", "Switch to light mode");
    await page.locator("#theme-toggle").click();
    expect(await theme(page)).toBe("light");
    expect(await style(page.locator("body"), "backgroundColor")).toBe("rgb(244, 245, 247)");
    const logo = card(page, "cfb:1").locator(".team.away img");
    await expect(logo).toHaveAttribute("src", /\/500\/194\.png$/);
    expect(await style(logo, "filter")).toBe("none");
    await expect(row(page, "cfb:1").locator("img").first()).toHaveAttribute("src", /\/500\/194\.png$/);
    await page.reload();
    expect(await theme(page)).toBe("light");
    await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-label", "Switch to dark mode");
  });

  test.describe("on a light device", () => {
    test.use({ colorScheme: "light" });

    test("starts in light mode, before any script but the inline one runs", async ({ page }) => {
      await page.route("**/js/main.js", (route) => route.abort());  // prove the pre-paint snippet alone sets it
      await page.goto("/index.html");
      expect(await theme(page)).toBe("light");
    });

    test("a saved dark choice wins over the device", async ({ page }) => {
      await open(page, { storage: { theme: "dark" } });
      expect(await theme(page)).toBe("dark");
    });
  });
});

test.describe("animations ignore the OS reduced-motion setting", () => {
  test.use({ reducedMotion: "reduce" });

  test("red-zone glow and Cignetti still animate", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    expect(await style(card(page, "cfb:1"), "animationName")).toBe("redzone-glow");
    await page.locator("#settings").click();
    await page.locator("#google-me").click();
    expect(await page.locator("#coach").evaluate((c) => c.getAnimations().length)).toBeGreaterThan(0);
  });
});

test.describe("desktop game list panel", () => {
  test("☰ slides the list out and back, the board widens, and the choice is remembered", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"] } });
    const aside = page.locator("aside");
    const boardX = async () => (await page.locator("#board").boundingBox()).x;
    expect(await boardX()).toBeGreaterThan(290);
    await page.locator("#panel-toggle").click();
    await expect(aside).toBeHidden();
    await expect.poll(boardX).toBeLessThan(5);
    await expect(page.locator("#panel-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(aside).toBeHidden();
    await page.locator("#panel-toggle").click();
    await expect(aside).toBeVisible();
    await expect.poll(boardX).toBeGreaterThan(290);
  });

  test("cards animate to their new sizes and positions when the list hides or shows", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1", "cfb:2", "cfb:3"] } });
    const third = card(page, "cfb:3");
    const before = await third.boundingBox();
    await page.locator("#panel-toggle").click();
    const moving = await page.locator(".card").evaluateAll((cards) =>
      cards.filter((c) => c.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.transform?.includes("translate")))).length);
    expect(moving).toBe(3);
    await page.waitForTimeout(400);
    const after = await third.boundingBox();
    expect(after.y).toBeLessThan(before.y);  // third card moved up into the first row
  });

  test("the slide uses the same timing as the phone drawer", async ({ page }) => {
    await open(page);
    const desktop = await style(page.locator("aside"), "transition");
    expect(desktop).toContain("transform 0.25s");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await style(page.locator("#picker-body"), "transition")).toContain("transform 0.25s");
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("in grid view, an upcoming card's ✕ sits beside the scoreboard instead of on a row of its own", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:5", "cfb:7"], pickerOpen: false, view: "grid" } });
    test.skip(await page.evaluate(() => matchMedia("(hover: hover)").matches), "emulated device reports hover");
    const [score, remove] = await Promise.all([card(page, "cfb:5").locator(".score").boundingBox(), card(page, "cfb:5").locator(".remove").boundingBox()]);
    expect(remove.y).toBeLessThan(score.y + score.height);  // level with the scoreboard
    expect(remove.x).toBeGreaterThan(score.x + score.width);  // beside it
    // A final with a network keeps its footer row for the network.
    const final = await Promise.all([card(page, "cfb:7").locator(".score").boundingBox(), card(page, "cfb:7").locator(".remove").boundingBox()]);
    expect(final[1].y).toBeGreaterThan(final[0].y + final[0].height);
  });

  test("a phone on its side (wide but short) gets the phone layout too", async ({ page }) => {
    await page.setViewportSize({ width: 750, height: 342 });
    await open(page, { storage: { selected: ["cfb:1", "cfb:2"], pickerOpen: false } });
    await expect(page.locator("#picker-toggle")).toBeVisible();  // the Games bar, not the side panel
    await expect(page.locator("aside")).toHaveClass(/collapsed/);
    await expect(card(page, "cfb:1")).toHaveClass(/line/);  // phones start in list view
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("with no picks, the board says to tap the Games bar", async ({ page }) => {
    await open(page, { storage: { pickerOpen: false } });
    await expect(page.locator("#board .empty .mobile-only")).toHaveText("Tap ☰ Games at the top to pick a few games, and they'll show up here.");
    await expect(page.locator("#board .empty .desktop-only")).toBeHidden();
  });

  test("phones start in list view until the viewer picks grid", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"], pickerOpen: false } });
    await expect(card(page, "cfb:1")).toHaveClass(/line/);
    await page.locator("#view-toggle").click();
    await expect(card(page, "cfb:1")).not.toHaveClass(/line/);
    await page.reload();
    await expect(card(page, "cfb:1")).not.toHaveClass(/line/);  // the choice sticks
  });

  test("list view has no horizontal scrolling, and stacks away over home", async ({ page }) => {
    await open(page, { storage: { selected: ALL_CFB, pickerOpen: false, view: "list" } });
    await expect(page.locator("#board .card.line").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const [away, home] = await card(page, "cfb:1").locator(".team").evaluateAll((ts) => ts.map((t) => t.getBoundingClientRect().top));
    expect(home).toBeGreaterThan(away);
  });

  test("no horizontal scrolling and team names fit on cards", async ({ page }) => {
    await open(page, { storage: { selected: ALL_CFB, pickerOpen: false } });
    await expect(card(page, "cfb:1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const clipped = await page.locator(".card .name").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(clipped).toBe(0);
  });

  test("phones around 500px wide fit two stacked Final/Upcoming cards to a row, with even margins", async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await open(page, { storage: { selected: ["cfb:7", "cfb:5", "cfb:6"], pickerOpen: false, view: "grid" } });
    const box = (key) => card(page, key).boundingBox();
    const [fin, up1, up2] = [await box("cfb:7"), await box("cfb:5"), await box("cfb:6")];
    expect(Math.abs(up1.y - up2.y)).toBeLessThan(1);                // side by side
    expect(Math.abs(up1.width - up2.width)).toBeLessThan(1);
    expect(Math.abs(up1.x - (500 - (up2.x + up2.width)))).toBeLessThan(1);  // same margin left and right
    // A lone Final card keeps to one column, the same size as the Upcoming cards below it.
    expect(Math.abs(fin.x - up1.x)).toBeLessThan(1);
    expect(Math.abs(fin.width - up1.width)).toBeLessThan(1);
    // Narrow cards stack away over home, with the status on the right.
    expect(await card(page, "cfb:5").locator(".score").evaluate((el) => getComputedStyle(el).gridTemplateAreas)).toContain("away clock");
    const away = await card(page, "cfb:5").locator(".team.away").boundingBox(), home = await card(page, "cfb:5").locator(".team.home").boundingBox();
    expect(home.y).toBeGreaterThan(away.y + away.height - 1);
    const clipped = await page.locator(".card .abbr").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > e.closest(".name").getBoundingClientRect().right + 1).length);
    expect(clipped).toBe(0);
  });

  test("picker is a drawer: opens by default with no picks, closes via ✕, backdrop, Done and Escape", async ({ page }) => {
    await open(page);
    const aside = page.locator("aside");
    await expect(aside).not.toHaveClass(/collapsed/);
    await page.locator("#picker-close").click();
    await expect(aside).toHaveClass(/collapsed/);
    await page.locator("#picker-toggle").click();
    await expect(aside).not.toHaveClass(/collapsed/);
    await page.locator("#picker-backdrop").click({ position: { x: 370, y: 400 } });
    await expect(aside).toHaveClass(/collapsed/);
    await page.locator("#picker-toggle").click();
    await page.locator("#picker-done").click();
    await expect(aside).toHaveClass(/collapsed/);
    await page.locator("#picker-toggle").click();
    await page.keyboard.press("Escape");
    await expect(aside).toHaveClass(/collapsed/);
  });

  test("the desktop ☰ button is hidden, and a saved hidden panel doesn't hide the phone layout", async ({ page }) => {
    await open(page, { storage: { panelCollapsed: true, pickerOpen: false } });
    await expect(page.locator("#panel-toggle")).toBeHidden();
    await expect(page.locator("#picker-toggle")).toBeVisible();
  });

  test("the gear floats in the corner wherever you scroll, its menu opens above it, and the contact link sits in the footer", async ({ page }) => {
    await open(page, { storage: { selected: ALL_CFB, pickerOpen: false } });
    for (const y of [0, 600]) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      const gear = await page.locator("#settings").boundingBox();
      expect(gear.width).toBeGreaterThanOrEqual(44);
      expect(gear.y + gear.height).toBeLessThanOrEqual(844);  // in view, at the bottom
      expect(gear.y + gear.height).toBeGreaterThan(844 - 80);
    }
    await expect(page.locator("#contact a")).toHaveAttribute("href", "mailto:sean@gametrackerlive.com");
    await page.locator("#settings").tap();
    await page.locator("#settings-menu").evaluate((m) => Promise.all(m.getAnimations().map((a) => a.finished)));
    const [menu, gear] = await Promise.all([page.locator("#settings-menu").boundingBox(), page.locator("#settings").boundingBox()]);
    expect(menu.y + menu.height).toBeLessThanOrEqual(gear.y);  // pops up above the gear
  });

  test("the gear menu repeats the header's view and theme switches, which scroll away; the Games bar shows the update time", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"], pickerOpen: false } });
    await expect(page.locator("#bar-updated")).toHaveText(/\d{1,2}:\d{2}:\d{2}/);
    await page.locator("#settings").tap();
    const view = page.locator("#menu-view"), theme = page.locator("#menu-theme");
    await expect(view).toBeVisible();
    await expect(view).toHaveAttribute("aria-pressed", "true");  // phones start in list view
    await view.tap();
    await expect(card(page, "cfb:1")).not.toHaveClass(/line/);
    await expect(view).toHaveAttribute("aria-pressed", "false");
    await expect(theme).toHaveAttribute("aria-pressed", "false");  // the tests run dark
    await theme.tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(theme).toHaveAttribute("aria-pressed", "true");
  });

  test("a clipped name never hides the possession dot", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await open(page, { storage: { selected: ALL_CFB, pickerOpen: false } });
    await expect(card(page, "cfb:1")).toBeVisible();
    const clipped = await page.locator(".card .poss:not(.hide)").evaluateAll((dots) =>
      dots.filter((d) => d.getBoundingClientRect().right > d.closest(".name").getBoundingClientRect().right + 0.5).length);
    expect(clipped).toBe(0);
    expect(await page.locator(".card .poss:not(.hide)").count()).toBeGreaterThan(0);
  });

  test("Games bar stays pinned to the top while scrolling", async ({ page }) => {
    await open(page, { storage: { selected: ALL_CFB, pickerOpen: false } });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(async () => (await page.locator("#picker-toggle").boundingBox()).y).toBe(0);
  });

  test("tapping a selected game closes the drawer and highlights its card", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"], pickerOpen: true } });
    await row(page, "cfb:1").locator(".bug").click();
    await expect(page.locator("aside")).toHaveClass(/collapsed/);
    await expect(card(page, "cfb:1")).toHaveClass(/flash/);
    await expect(row(page, "cfb:1").locator("input")).toBeChecked();
  });

  test("tapping an unselected game adds it", async ({ page }) => {
    await open(page);
    await row(page, "cfb:2").locator(".bug").click();
    await expect(row(page, "cfb:2").locator("input")).toBeChecked();
    await expect(card(page, "cfb:2")).toBeAttached();
  });

  test("touch screens keep the full-size, full-strength + circle", async ({ page }) => {
    await open(page);
    test.skip(await page.evaluate(() => matchMedia("(hover: hover)").matches), "emulated device reports hover");
    const plus = row(page, "cfb:5").locator(".pick");
    expect((await plus.boundingBox()).width).toBeCloseTo(28, 0);
    expect(await style(plus, "opacity")).toBe("1");
    await row(page, "cfb:5").locator(".bug").click();
    expect(await style(plus, "backgroundColor")).toBe("rgb(76, 141, 255)");  // solid ✓ once picked
  });

  test("arriving from a game link keeps the drawer shut so the card is in view", async ({ page }) => {
    await open(page, { query: "?game=cfb:1", storage: { pickerOpen: true } });
    await expect(page.locator("aside")).toHaveClass(/collapsed/);
    await expect(card(page, "cfb:1")).toBeInViewport();
  });

  test("✕ on cards is always visible on touch screens", async ({ page }) => {
    await open(page, { storage: { selected: ["cfb:1"], pickerOpen: false } });
    test.skip(await page.evaluate(() => matchMedia("(hover: hover)").matches), "emulated device reports hover");
    expect(await style(card(page, "cfb:1").locator(".remove"), "opacity")).toBe("1");
  });
});

test.describe("NFL", () => {
  test("NFL games list and render", async ({ page }) => {
    await open(page, { storage: { tab: "nfl", selected: ["nfl:101"] } });
    await expect(page.locator("#list .group-label")).toHaveText([/Selected\s*1/, /Upcoming\s*1/]);
    await expect(card(page, "nfl:101").locator(".dd")).toHaveText("1st & 10 at NE 40");
  });
});
