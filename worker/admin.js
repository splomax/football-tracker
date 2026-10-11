// The admin's extra controls, served only to a logged-in admin by the Worker (worker/index.js) and loaded by
// js/admin.js. It runs from a blob: URL, so it can't import the app's modules; install() is handed what it needs.
//
// - A share button on live cards, which links to ?game=league:id (js/config.js's LINKED_GAMES).
// - "Save as image" beside each section heading. Live and Final save the section's cards as they look right now.
//   Upcoming saves a list made for posting on a forum: grouped by day, one row per game (kickoff time, away @ home
//   with logos, ranks and records, network).
// - "Save board as image" in the gear menu: the whole board as it looks right now.
// - The visit counter's weekly, monthly and total counts atop the gear menu, fetched each time it opens.
// - In the game list, a row of bulk buttons atop each section: Live, Upcoming and Final get "Select all" (every game
//   the section shows) and "Remove all" (that state's picked games, which sit under Selected); Selected gets
//   "Remove all" (every picked game in the current tab and filters).
// Every image is in the current theme, gives kickoff times in Eastern time whatever the admin's own time zone, and
// carries a small, muted Game Tracker logo in the bottom-right corner.

let app;  // { renderBoard, renderList, listView, allGames, state, saveSelected, currentTheme, setTimeZone, visits } from js/admin.js

const IMAGE_ZONE = "America/New_York";  // the time zone of every kickoff time in an image

/** Returns the hooks for js/board.js's setAdmin. */
export function install(appApi) {
  app = appApi;
  addBoardShot();
  addVisits();
  return {
    groupExtras,
    onListClick(e) {
      const button = e.target.closest("[data-bulk]");
      if (!button) return false;
      const add = button.dataset.bulk === "add";
      bulkGames(button.dataset.group, add).forEach((g) => (add ? app.state.selected.add(g.key) : app.state.selected.delete(g.key)));
      app.saveSelected();
      app.renderList();
      app.renderBoard();
      return true;
    },
    cardExtras: (g) => (g.state === "in" ? shareButton(g) : ""),
    sectionExtras: () => posterButton(),
    onBoardClick(e) {
      const shareKey = e.target.closest("[data-share]")?.dataset.share;
      const game = shareKey && app.allGames().find((g) => g.key === shareKey);
      if (game) { share(game); return true; }
      const button = e.target.closest("[data-poster]");
      if (!button) return false;
      const st = button.closest(".board-group").dataset.section;
      (st === "pre" ? posterImage() : sectionImage(st)).then(deliver);
      return true;
    },
  };
}

const STATE_OF = { Live: "in", Upcoming: "pre", Final: "post" };

// The bulk buttons atop one game-list section. A state's "Remove all" only shows while some of its games are picked
// (they sit under Selected).
function groupExtras(group) {
  const button = (action, label) => `<button type="button" data-bulk="${action}" data-group="${group}">${label}</button>`;
  if (group === "Selected") return `<div class="group-actions">${button("remove", "Remove all")}</div>`;
  return `<div class="group-actions">${button("add", "Select all")}${bulkGames(group, false).length ? button("remove", "Remove all") : ""}</div>`;
}

// The games a bulk button acts on, worked out from the games as they are now rather than when the list was drawn
// (it redraws only every LIST_REFRESH_MS, and a game can kick off or end in between). Within the current tab and
// filters: unpicked games of the section's state to add, picked ones to remove; Selected removes every picked game.
function bulkGames(group, add) {
  return app.listView().filter((g) => (group === "Selected" || g.state === STATE_OF[group]) && app.state.selected.has(g.key) !== add);
}

let copied = null;  // { key, at }: the card whose share link was just copied, shown as a ✓ for a moment
const COPIED_MS = 1500;
// Box with an arrow out of it, the usual share glyph.
const SHARE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8"/></svg>`;

function shareButton(g) {
  const done = copied?.key === g.key && Date.now() - copied.at < COPIED_MS;
  const label = done ? "Link copied" : "Share this game";
  return `<button class="share ${done ? "done" : ""}" data-share="${g.key}" aria-label="${label}" title="${label}">${done ? "✓" : SHARE_ICON}</button>`;
}

/** A link to the site that picks this game on arrival. */
function gameLink(key) {
  return `${location.origin}${location.pathname}?game=${key}`;
}

// Touch screens open the phone's share sheet; with a mouse, or where there's no share sheet, the link is copied.
async function share(g) {
  const url = gameLink(g.key), title = `${g.away.abbr} @ ${g.home.abbr}`;
  if (navigator.share && matchMedia("(hover: none)").matches) {
    try { await navigator.share({ title, url }); } catch {}  // closing the sheet without sharing throws; nothing to do
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt("Copy this link:", url);  // no clipboard access (e.g. not https)
    return;
  }
  copied = { key: g.key, at: Date.now() };
  app.renderBoard();
  setTimeout(app.renderBoard, COPIED_MS);
}

function posterButton() {
  return `<button class="poster" data-poster title="Save these games as an image">Save as image</button>`;
}

// Gear menu: the visit counts, refreshed whenever the menu opens. The gear's click opens the menu before this runs.
function addVisits() {
  const menu = document.getElementById("settings-menu");
  if (!menu || document.getElementById("visits")) return;
  const row = document.createElement("div");
  row.id = "visits";
  menu.prepend(row);
  const cell = (n, label) => `<span><b>${n ?? "–"}</b>${label}</span>`;
  const refresh = async () => {
    const v = await app.visits();
    row.innerHTML = cell(v?.weekly, "week") + cell(v?.monthly, "month") + cell(v?.total, "total");
  };
  refresh();
  const gear = document.getElementById("settings");
  gear.addEventListener("click", () => { if (gear.getAttribute("aria-expanded") === "true") refresh(); });
}

const W = 640, PAD = 24, ROW = 44, DAY_HEAD = 34, FOOT = 34, SCALE = 2;
const TIME_W = 78, NET_W = 120, LOGO = 24;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

// Gear menu item. Lined up with "google me", whose ✓ column it shares.
function addBoardShot() {
  const menu = document.getElementById("settings-menu");
  if (!menu || document.getElementById("save-board")) return;
  const button = document.createElement("button");
  button.id = "save-board";
  button.innerHTML = `<span class="check"></span>Save board as image`;
  button.addEventListener("click", async () => { const image = await boardImage(); if (image) deliver(image); });
  menu.append(button);
}

// Turns DOM into an image by drawing a copy of it, styles, fonts and logos inlined; loaded only when first used.
const HTML_TO_IMAGE = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm";
// Card controls that would only clutter the picture.
const LEFT_OUT = ["remove", "share", "poster", "last-full"];

const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Each image comes as { blob, name }, the name being what a download is saved as.

// The board already has room around its cards (css/board.css: 16px, and 32px below, where the logo goes).
// Null when nothing is picked.
async function boardImage() {
  const board = document.getElementById("board");
  if (!board.querySelector(".card")) return null;
  return { blob: await snapshot(() => board, 0, 0), name: "game-tracker.png" };
}

// The board redraws every poll, replacing its sections, so a section is looked up by its state when it's drawn.
const sectionEl = (st) => document.querySelector(`#board .board-group[data-section="${st}"]`);

// A section has no padding of its own, so give it the board's: 16px around, plus 16px more below for the logo.
// It's cut off after its last card, so a lone card doesn't sit beside a wide empty space.
async function sectionImage(st) {
  const width = (section) => {
    const right = Math.max(...[...section.querySelectorAll(".card")].map((c) => c.getBoundingClientRect().right));
    return Math.ceil(right - section.getBoundingClientRect().left);
  };
  return { blob: await snapshot(() => sectionEl(st), 16, 16, width), name: `game-tracker-${st === "in" ? "live" : "final"}.png` };
}

// The Upcoming section's cards, as the forum list.
async function posterImage() {
  const games = [...sectionEl("pre").querySelectorAll(".card")].map((c) => app.allGames().find((g) => g.key === c.dataset.key)).filter(Boolean);
  return { blob: await drawPoster(games), name: "upcoming-games.png" };
}

/**
 * Part of the page as it looks right now, including anything scrolled out of view, on the page's background.
 * @param getNode  finds the element once the image library has loaded, so a board redraw meanwhile doesn't matter
 * @param pad  space added on every side; @param foot  extra space added below. The logo sits 16px from the bottom.
 * @param keepWidth  how much of the node's width to keep, from its left edge; the node itself keeps its layout.
 */
async function snapshot(getNode, pad, foot, keepWidth = (node) => node.clientWidth) {
  const { toCanvas } = await import(HTML_TO_IMAGE);
  // Redraw the cards with Eastern kickoff times for the capture, then put the viewer's own back.
  app.setTimeZone(IMAGE_ZONE);
  app.renderBoard();
  let node, width, height, shot;
  const bg = cssColor("--bg");
  try {
    node = getNode();
    await logosSettled(node);
    width = keepWidth(node);
    height = node.scrollHeight;
    shot = await toCanvas(node, {
      width, height, pixelRatio: SCALE, backgroundColor: bg,
      style: { width: `${node.clientWidth}px`, height: `${height}px`, overflow: "visible", margin: "0" },
      filter: (el) => !LEFT_OUT.some((c) => el.classList?.contains(c)),
      imagePlaceholder: BLANK,  // an image that still won't load is left blank rather than failing the whole picture
    });
  } finally {
    app.setTimeZone(undefined);
    app.renderBoard();
  }
  const w = width + 2 * pad, h = height + 2 * pad + foot;
  const canvas = document.createElement("canvas");
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(shot, pad * SCALE, pad * SCALE);
  ctx.scale(SCALE, SCALE);
  await drawMark(ctx, w - 16, h - 16);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// The redraw above reloads every team logo, and some teams have no dark-mode logo: js/format.js then swaps in the
// regular one when the first fails. Wait for each logo to finish, fallback included, before the capture copies them.
function logosSettled(node, timeout = 3000) {
  const settled = (img) => img.complete && (img.naturalWidth > 0 || !img.getAttribute("onerror"));
  return Promise.all([...node.querySelectorAll("img")].map((img) => new Promise((resolve) => {
    const check = () => (settled(img) ? resolve() : null);
    img.addEventListener("load", check);
    img.addEventListener("error", () => setTimeout(check));  // after the onerror swap has run
    check();
    setTimeout(resolve, timeout);
  })));
}

// The logo on every image: the header's football, GAME TRACKER in its wordmark font, and the site's address, small
// and muted, right-aligned on (right, mid).
async function drawMark(ctx, right, mid) {
  const [ball] = await Promise.all([loadImage("images/favicon.svg"), document.fonts.load(`700 13px "Barlow Condensed"`)]);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = cssColor("--muted");
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  // Right to left: the site's address, a dot, the wordmark, the football.
  ctx.font = `12px ${FONT}`;
  ctx.fillText(SITE, right, mid);
  let x = right - ctx.measureText(SITE).width - 8;
  ctx.fillText("·", x, mid);
  x -= ctx.measureText("·").width + 8;
  ctx.font = `700 13px "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.letterSpacing = "1.5px";
  ctx.fillText("GAME TRACKER", x, mid + 1);
  x -= ctx.measureText("GAME TRACKER").width;
  if (ball) ctx.drawImage(ball, x - 20, mid - 8, 16, 16);
  ctx.restore();
}

const SITE = "gametrackerlive.com";

// The share sheet on touch screens (so it can go to Photos or straight into a post), a download otherwise.
async function deliver({ blob, name }) {
  const file = new File([blob], name, { type: "image/png" });
  if (matchMedia("(hover: none)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}  // closing the sheet without sharing throws
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function drawPoster(games) {
  const days = groupByDay(games);
  const height = PAD + days.reduce((h, d) => h + DAY_HEAD + d.games.length * ROW, 0) + FOOT + PAD / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  const color = cssColor;
  const logos = await loadLogos(games);

  ctx.fillStyle = color("--bg");
  ctx.fillRect(0, 0, W, height);
  ctx.textBaseline = "middle";

  let y = PAD;

  for (const day of days) {
    ctx.fillStyle = color("--muted");
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(day.label.toUpperCase(), PAD, y + DAY_HEAD / 2 + 2);
    y += DAY_HEAD;
    day.games.forEach((g, i) => {
      ctx.fillStyle = color(i % 2 ? "--bg" : "--card");
      roundRect(ctx, PAD - 8, y + 2, W - 2 * PAD + 16, ROW - 4, 6);
      drawRow(ctx, g, y + ROW / 2, logos, color);
      y += ROW;
    });
  }

  ctx.fillStyle = color("--muted");
  ctx.font = `12px ${FONT}`;
  ctx.fillText(`All times ${zoneName(games[0].date)}`, PAD, y + FOOT / 2);
  await drawMark(ctx, W - PAD, y + FOOT / 2);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function drawRow(ctx, g, mid, logos, color) {
  ctx.textAlign = "left";
  ctx.fillStyle = color("--text");
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: IMAGE_ZONE }), PAD, mid);

  if (g.network) {
    ctx.textAlign = "right";
    ctx.fillStyle = color("--muted");
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(fit(ctx, g.network, NET_W), W - PAD, mid);
    ctx.textAlign = "left";
  }

  // Away @ home around a fixed "@" column, so every row's logos line up: the away team is right-aligned against the
  // "@" (name, then logo), the home team left-aligned after it (logo, then name). If either side's rank, name and
  // record don't fit, the row drops both records; names that still don't fit are cut short.
  const left = PAD + TIME_W, right = W - PAD - NET_W - 12, at = (left + right) / 2;
  const textRoom = at - AT_GAP - LOGO - 6 - left;
  const withRecords = [g.away, g.home].every((t) => sideWidth(ctx, t, true) <= textRoom);
  ctx.textAlign = "center";
  ctx.fillStyle = color("--muted");
  ctx.font = `14px ${FONT}`;
  ctx.fillText("@", at, mid);
  ctx.textAlign = "left";
  const awayLogo = at - AT_GAP - LOGO, homeLogo = at + AT_GAP;
  drawLogo(ctx, logos.get(g.away.logo), awayLogo, mid);
  drawLogo(ctx, logos.get(g.home.logo), homeLogo, mid);
  drawSide(ctx, g.away, awayLogo - 6 - Math.min(sideWidth(ctx, g.away, withRecords), textRoom), mid, withRecords, textRoom, color);
  drawSide(ctx, g.home, homeLogo + LOGO + 6, mid, withRecords, textRoom, color);
}

const AT_GAP = 14;  // from the middle of the "@" to the nearer edge of each logo

function drawLogo(ctx, logo, x, mid) {
  if (logo) ctx.drawImage(logo, x, mid - LOGO / 2, LOGO, LOGO);
}

const rank = (t) => (t.rank && t.rank <= 25 ? String(t.rank) : "");
const record = (t, withRecords) => (withRecords && t.record ? ` (${t.record})` : "");

// One team's "rank Name (record)", in drawSide's fonts.
function sideWidth(ctx, t, withRecords) {
  let w = 0;
  ctx.font = `600 11px ${FONT}`;
  if (rank(t)) w += ctx.measureText(rank(t)).width + 3;
  ctx.font = `600 14px ${FONT}`;
  w += ctx.measureText(t.name ?? t.abbr).width;
  ctx.font = `12px ${FONT}`;
  w += ctx.measureText(record(t, withRecords)).width;
  return w;
}

// "rank Name (record)" starting at x, the name cut short so the whole thing fits in room.
function drawSide(ctx, t, x, mid, withRecords, room, color) {
  ctx.font = `600 11px ${FONT}`;
  const rankW = rank(t) ? ctx.measureText(rank(t)).width + 3 : 0;
  ctx.font = `12px ${FONT}`;
  const recW = ctx.measureText(record(t, withRecords)).width;
  if (rank(t)) {
    ctx.fillStyle = color("--muted");
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(rank(t), x, mid + 1);
  }
  ctx.fillStyle = color("--text");
  ctx.font = `600 14px ${FONT}`;
  const name = fit(ctx, t.name ?? t.abbr, room - rankW - recW);
  ctx.fillText(name, x + rankW, mid);
  if (recW) {
    const nameW = ctx.measureText(name).width;
    ctx.fillStyle = color("--muted");
    ctx.font = `12px ${FONT}`;
    ctx.fillText(record(t, withRecords), x + rankW + nameW, mid + 1);
  }
}

// Cut text down with an ellipsis until it fits. Uses the context's current font.
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > width) text = text.slice(0, -1);
  return text.trimEnd() + "…";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// Days in date order (Eastern). Within a day, games keep the board's kickoff order.
function groupByDay(games) {
  const dayOf = (g) => g.date.toLocaleDateString("en-CA", { timeZone: IMAGE_ZONE });  // "2026-10-03", sorts as text
  const days = [];
  for (const g of games.toSorted((a, b) => dayOf(a).localeCompare(dayOf(b)))) {
    const label = g.date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", timeZone: IMAGE_ZONE });
    if (days.at(-1)?.label !== label) days.push({ label, games: [] });
    days.at(-1).games.push(g);
  }
  return days;
}

// IMAGE_ZONE's short name on that date, "EDT" or "EST", for the footer.
function zoneName(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: IMAGE_ZONE, timeZoneName: "short" }).formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value ?? "ET";
}

// Logos have to come from ESPN with CORS, or the canvas can't be exported. Same dark-variant rule as js/format.js.
// A logo that won't load is left out rather than holding up the image.
async function loadLogos(games) {
  const urls = [...new Set(games.flatMap((g) => [g.away.logo, g.home.logo]).filter(Boolean))];
  const dark = app.currentTheme() !== "light";
  const entries = await Promise.all(urls.map(async (url) =>
    [url, (dark && await loadImage(url.replace("/500/", "/500-dark/"))) || await loadImage(url)]));
  return new Map(entries);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
