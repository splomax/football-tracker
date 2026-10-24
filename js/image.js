// "Save board as image" in the gear menu: every game on the board as a list made for posting on a forum, grouped
// by day, one row per game (kickoff time until it starts, away @ home with logos, ranks and records, network), by kickoff. Live and
// final games are listed by their kickoff too, with their score beside each logo and, centered under the scores like a
// TV scorebug, the clock and quarter (or Half, or Final). The image is in the current theme, gives kickoff times in Eastern time
// whatever the viewer's own time zone, and carries a small, muted Game Tracker Live logo in the bottom-right corner.
// Loaded by js/settings.js the first time it's used.

import { allGames } from "./state.js";
import { currentTheme } from "./theme.js";
import { statusLines } from "./format.js";

const IMAGE_ZONE = "America/New_York";  // the time zone of every kickoff time in the image

/** Saves the board's games as the list: the share sheet on touch screens, a download otherwise. Nothing when no games are picked. */
export async function saveBoardImage() {
  const image = await boardImage();
  if (image) deliver(image);
}

const W = 640, PAD = 24, ROW = 44, STATUS = 14, DAY_HEAD = 34, FOOT = 34, SCALE = 2;
const TIME_W = 78, NET_W = 120, LOGO = 24;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

// A started game's row is taller, for its clock and quarter under the scores.
const rowHeight = (g) => (g.state === "pre" ? ROW : ROW + STATUS);

const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Every game on the board, as { blob, name }, the name being what a download is saved as. Null when nothing is picked.
async function boardImage() {
  const games = [...document.querySelectorAll("#board .card")].map((c) => allGames().find((g) => g.key === c.dataset.key))
    .filter(Boolean).toSorted((a, b) => a.date - b.date);
  if (!games.length) return null;
  return { blob: await drawList(games), name: "game-tracker-live.png" };
}

// The logo on every image: the header's football, GAME TRACKER in its wordmark font with its red LIVE badge, and the
// site's address, small and muted, right-aligned on (right, mid).
async function drawMark(ctx, right, mid) {
  const [ball] = await Promise.all([loadImage("images/favicon.svg"), document.fonts.load(`700 13px "Barlow Condensed"`)]);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = cssColor("--muted");
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  // Right to left: the site's address, a dot, the LIVE badge, the wordmark, the football.
  ctx.font = `12px ${FONT}`;
  ctx.fillText(SITE, right, mid);
  let x = right - ctx.measureText(SITE).width - 8;
  ctx.fillText("·", x, mid);
  x -= ctx.measureText("·").width + 8;
  ctx.font = `700 10px "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.letterSpacing = "1px";
  const badge = ctx.measureText("LIVE").width + 8;
  ctx.fillStyle = cssColor("--live-badge");
  ctx.beginPath();
  ctx.roundRect(x - badge, mid - 6, badge, 13, 3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText("LIVE", x - 4, mid + 0.5);  // half a pixel low of middle centers the font's capitals in the pill
  x -= badge + 5;
  ctx.fillStyle = cssColor("--muted");
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

async function drawList(games) {
  const days = groupByDay(games);
  const height = PAD + days.reduce((h, d) => h + DAY_HEAD + d.games.reduce((r, g) => r + rowHeight(g), 0), 0) + FOOT + PAD / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  const color = cssColor;
  const logos = await loadLogos(games);
  // With any score in the image, every row leaves room for one either side of the "@", so the logos still line up.
  const gap = games.some((g) => g.state !== "pre") ? AT_GAP + SCORE_W : AT_GAP;

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
      roundRect(ctx, PAD - 8, y + 2, W - 2 * PAD + 16, rowHeight(g) - 4, 6);
      drawRow(ctx, g, y + ROW / 2 + (rowHeight(g) - ROW) / 4, logos, color, gap);
      y += rowHeight(g);
    });
  }

  ctx.fillStyle = color("--muted");
  ctx.font = `12px ${FONT}`;
  ctx.fillText(`All times ${zoneName(games[0].date)}`, PAD, y + FOOT / 2);
  await drawMark(ctx, W - PAD, y + FOOT / 2);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function drawRow(ctx, g, mid, logos, color, gap) {
  ctx.textAlign = "left";
  ctx.fillStyle = color("--text");
  ctx.font = `600 13px ${FONT}`;
  if (g.state === "pre") ctx.fillText(g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: IMAGE_ZONE }), PAD, mid);

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
  const textRoom = at - gap - LOGO - 6 - left;
  const withRecords = [g.away, g.home].every((t) => sideWidth(ctx, t, true) <= textRoom);
  ctx.textAlign = "center";
  ctx.fillStyle = color("--muted");
  ctx.font = `14px ${FONT}`;
  // A started game's scores line up with the names, with the clock and quarter centered under them.
  const scoreMid = mid;
  ctx.fillText("@", at, scoreMid);
  if (g.state !== "pre") {
    ctx.fillStyle = color(g.state === "in" ? "--red" : "--muted");
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(statusLines(g).replace("<br>", " ").replace("&nbsp;", "").trim(), at, mid + 18);  // "8:12 2nd", "Half", "Final/OT"
    ctx.fillStyle = color("--text");
    ctx.font = `700 16px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(g.away.score ?? "", at - AT_GAP, scoreMid);
    ctx.textAlign = "left";
    ctx.fillText(g.home.score ?? "", at + AT_GAP, scoreMid);
  }
  ctx.textAlign = "left";
  const awayLogo = at - gap - LOGO, homeLogo = at + gap;
  drawLogo(ctx, logos.get(g.away.logo), awayLogo, mid);
  drawLogo(ctx, logos.get(g.home.logo), homeLogo, mid);
  drawSide(ctx, g.away, awayLogo - 6 - Math.min(sideWidth(ctx, g.away, withRecords), textRoom), mid, withRecords, textRoom, color);
  drawSide(ctx, g.home, homeLogo + LOGO + 6, mid, withRecords, textRoom, color);
}

const AT_GAP = 14;  // from the middle of the "@" to the nearer edge of each logo (or score)
const SCORE_W = 30;  // room for a score between the "@" and a logo

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

// Days in date order (Eastern). Within a day, games keep their kickoff order.
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
  const dark = currentTheme() !== "light";
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
