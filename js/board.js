// The board: one card per picked game, college and NFL together.

import { GLOW_MS, FLASH_MS } from "./config.js";
import { state, saveSelected, allGames } from "./state.js";
import { logoImg, rankBadge, statusLines, escapeAttr, leads } from "./format.js";
import { field } from "./field.js";
import { recapUrl } from "./recap.js";
import { isListView } from "./view.js";
import { STATS_BETA, statsFor, short } from "./stats.js";

const $ = (id) => document.getElementById(id);

const redZoneShown = new Set();  // game keys currently drawn in the red zone
const glowStart = new Map();     // game key -> when its one-time glow began
let flash = null;                // { key, at }: the card most recently highlighted from the picker
let openPlay = null;             // game key whose full last-play text is showing; survives board refreshes
// Extra controls for a logged-in admin (js/admin.js). Regular visitors never load that code, so these stay empty.
let admin = { cardExtras: () => "", onBoardClick: () => false };

/** @param {{ cardExtras?: (g) => string, onBoardClick?: (e) => boolean }} hooks */
export function setAdmin(hooks) {
  admin = { ...admin, ...hooks };
}

const SECTIONS = [["in", "Live"], ["post", "Final"], ["pre", "Upcoming"]];

export function renderBoard() {
  // The admin's test-kind chooser is a native dropdown: redrawing the board would close it, so wait while it's open.
  if (document.activeElement?.matches?.("#board select")) return;
  const picked = allGames().filter((g) => state.selected.has(g.key)).sort((a, b) => a.date - b.date);
  $("picker-count").textContent = picked.length ? `${picked.length} selected` : "";
  if (!picked.length) {
    // The picker sits on the left on desktop but hides behind the "☰ Games" bar on phones; CSS shows the matching hint.
    $("board").innerHTML = `<div class="empty">
      <span class="desktop-only">Pick a few games from the list on the left and they'll show up here.</span>
      <span class="mobile-only">Tap ☰ Games at the top to pick a few games, and they'll show up here.</span></div>`;
    return;
  }
  const before = cardSpots();
  // Live, then Final, then Upcoming; a section only shows when it has games. List view puts every section in one grid,
  // so all rows share one width and their columns line up (css/board.css .line-grid).
  const list = isListView();
  const sections = SECTIONS.map(([st, label]) => {
    const games = picked.filter((g) => g.state === st);
    return games.length ? `<section class="board-group ${st === "in" ? "live" : "compact"}" data-section="${st}">
      <h2 class="board-section">${label}</h2><div class="cards">${games.map(list ? lineCard : card).join("")}</div></section>` : "";
  }).join("");
  // Safari (WebKit) loses the scroll position when the board's contents are swapped: laying out the new sections, which
  // are CSS size containers, briefly makes the page (and on desktop, the board) too short, which clamps the scroll to
  // the top. Every poll redraws, so put both back before the next paint.
  const board = $("board"), pageY = scrollY, boardY = board.scrollTop;
  board.innerHTML = list ? `<div class="line-grid">${sections}</div>` : sections;
  if (scrollY !== pageY) scrollTo(0, pageY);
  if (board.scrollTop !== boardY) board.scrollTop = boardY;
  animateSectionChanges(before);
}

// Each card's on-screen box and section, taken before a render replaces the cards.
function cardSpots() {
  return new Map([...document.querySelectorAll("#board .card")].map((c) =>
    [c.dataset.key, { box: c.getBoundingClientRect(), section: c.closest(".board-group").dataset.section }]));
}

/**
 * When a game changes section (it kicked off, or it ended), grow or shrink its card from its old spot and size
 * into the new one, and glide the cards it pushed around. Renders where nothing changed section don't animate.
 */
function animateSectionChanges(before) {
  const cards = [...document.querySelectorAll("#board .card")];
  const changed = (c) => before.has(c.dataset.key) && before.get(c.dataset.key).section !== c.closest(".board-group").dataset.section;
  if (!cards.some(changed)) return;
  for (const c of cards) {
    const was = before.get(c.dataset.key)?.box, now = c.getBoundingClientRect();
    if (!was) continue;
    const from = { transform: `translate(${was.left - now.left}px, ${was.top - now.top}px)` }, to = { transform: "none" };
    if (changed(c)) {
      // Animate the real size rather than scaling, so the text doesn't stretch; the field is revealed as it grows.
      Object.assign(from, { width: `${was.width}px`, height: `${was.height}px` });
      Object.assign(to, { width: `${now.width}px`, height: `${now.height}px` });
      c.style.overflow = "hidden";
    } else if (was.left === now.left && was.top === now.top) continue;
    c.animate([from, to], { duration: 400, easing: "ease" }).onfinish = () => { c.style.overflow = ""; };
  }
}

// A card's opening tag, the same in both views: red zone (with its one-time glow) and the picker's highlight flash.
function cardOpen(g, kind = "") {
  const inRedZone = g.state === "in" && g.redZone;
  if (inRedZone && !redZoneShown.has(g.key)) glowStart.set(g.key, Date.now());  // just entered the red zone
  inRedZone ? redZoneShown.add(g.key) : redZoneShown.delete(g.key);
  // The board re-renders every poll; a negative delay resumes a glow already in progress instead of restarting it.
  const glowAge = Date.now() - (glowStart.get(g.key) ?? -Infinity);
  const glowing = inRedZone && glowAge < GLOW_MS;
  // Same trick for the picker's "highlight this game" flash, which must survive a board refresh mid-animation.
  const flashAge = flash?.key === g.key ? Date.now() - flash.at : Infinity;
  const flashing = flashAge < FLASH_MS;
  return `<div class="card ${kind} ${inRedZone ? "redzone" : ""} ${glowing ? "glow" : ""} ${flashing ? "flash" : ""}" data-key="${g.key}"
    style="${glowing ? `animation-delay: -${glowAge}ms;` : ""}${flashing ? `--flash-delay: -${flashAge}ms;` : ""}">`;
}

// Stats mode (?stats-mode-beta): under a live game, each team's leading offensive player, away on the left and home on
// the right, and a button that opens both teams' passing, rushing and receiving leaders and team stats (js/stats.js).
const openStats = new Set();  // game keys with detailed stats open; survives board refreshes
const STAT_ROWS = [["Total yards", "totalYards"], ["Passing", "netPassingYards"], ["Rushing", "rushingYards"],
  ["Turnovers", "turnovers"], ["3rd down", "thirdDownEff"], ["Possession", "possessionTime"]];
const CHEVRON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
function statsBar(g) {
  if (!STATS_BETA || g.state !== "in") return "";
  const s = statsFor(g, renderBoard);
  if (!s) return "";
  const open = openStats.has(g.key);
  const who = (side) => (s[side].top ? short(s[side].top) : "");
  const row = (label, a, h) => `<tr><td>${a ?? ""}</td><th>${label}</th><td>${h ?? ""}</td></tr>`;
  // "Mateer<br>21/33 254 yds 1 TD 1 INT": the name, then ESPN's line without commas, in lowercase but TD and INT.
  const lead = (p) => (p ? `${p.name}<br><span class="stat">${p.value.replace(/,/g, "").replace(/\b(YDS|CAR|REC)\b/g, (w) => w.toLowerCase())}</span>` : "");
  return `<div class="stats">
      <span class="stats-away">${who("away")}</span><span class="stats-home">${who("home")}</span>
      <button type="button" class="stats-more ${open ? "open" : ""}" data-stats="${g.key}" aria-expanded="${open}"
        aria-label="${open ? "Hide" : "Show"} detailed stats" title="${open ? "Hide" : "Show"} detailed stats">${CHEVRON}</button>
    </div>
    ${open ? `<table class="stats-detail">
      <tr><td>${g.away.abbr}</td><th></th><td>${g.home.abbr}</td></tr>
      ${row("Passing", lead(s.away.pass), lead(s.home.pass))}
      ${row("Rushing", lead(s.away.rush), lead(s.home.rush))}
      ${row("Receiving", lead(s.away.rec), lead(s.home.rec))}
      ${STAT_ROWS.map(([label, k]) => row(label, s.away.box[k], s.home.box[k])).join("")}
    </table>` : ""}`;
}

function card(g) {
  const live = g.state === "in", recap = g.state === "post" && recapUrl(g.key);
  return `${cardOpen(g)}
    <div class="score">${team(g, g.away, "away", g.home)}<div class="clock">${statusLines(g)}</div>${team(g, g.home, "home", g.away)}</div>
    ${live ? `<div class="dd">${g.ddText || "&nbsp;"}</div>${field(g)}` : ""}
    ${statsBar(g)}
    <div class="card-foot ${(live && g.lastPlay) || recap || g.network ? "" : "bare"}">
      ${live && g.lastPlay
        ? `<div class="last" data-play="${g.key}" title="${escapeAttr(g.lastPlay)}">${g.lastPlay}</div>`
        : recap
          ? `<div class="last"><a class="recap" href="${escapeAttr(recap)}" target="_blank" rel="noopener">Recap ↗</a></div>`
          : `<div class="last">&nbsp;</div>`}
      ${g.network ? `<span class="net" title="Broadcast on ${escapeAttr(g.network)}">${g.network}</span>` : ""}
      ${admin.cardExtras(g)}
      <button class="remove" data-remove="${g.key}" aria-label="Remove game" title="Remove game">✕</button>
    </div>
    ${live && g.lastPlay && openPlay === g.key ? `<div class="last-full" data-play="${g.key}">${g.lastPlay}</div>` : ""}
  </div>`;
}

// List view: one row per game. The same parts as a card (so highlighting and the buttons all work),
// minus the field and last play: away and home around an "@" with the down & distance centered under the scores, then
// the clock, and the network (with the recap link, once there is one).
function lineCard(g) {
  const recap = g.state === "post" && recapUrl(g.key);
  return `${cardOpen(g, "line")}
    ${team(g, g.away, "away", g.home)}<span class="at">@</span>${team(g, g.home, "home", g.away)}
    <div class="clock">${statusLines(g).replace("<br>", " ")}</div>
    <span class="net" ${g.network ? `title="Broadcast on ${escapeAttr(g.network)}"` : ""}>${g.network}${recap
      ? ` <a class="recap" href="${escapeAttr(recap)}" target="_blank" rel="noopener">Recap ↗</a>` : ""}</span>
    <span class="line-tools">${admin.cardExtras(g)}<button class="remove" data-remove="${g.key}" aria-label="Remove game" title="Remove game">✕</button></span>
    <div class="dd">${g.state === "in" && g.ddText ? g.ddText : ""}</div>
    ${statsBar(g)}
  </div>`;
}

// One side of the scoreboard row. Every slot is always rendered (hidden when empty) so cards line up.
function team(g, t, side, other) {
  const live = g.state === "in";
  const pts = `<span class="pts ${leads(g, t, other) ? "lead" : ""}">${g.state === "pre" ? "" : t.score}</span>`;
  const name = `<div class="name">
      <div class="top">${rankBadge(t)}<span class="abbr">${t.abbr}</span><span class="poss ${live && g.possession === t.id ? "" : "hide"}">●</span></div>
      <div class="sub"><span class="rec">${t.record ?? ""}</span></div>
    </div>`;
  const logo = logoImg(t);
  // Mirrored: logo on the outside edge, points next to the clock.
  return `<div class="team ${side}">${side === "away" ? logo + name + pts : pts + name + logo}</div>`;
}

/**
 * Run a change that resizes the board (like hiding the game list) and animate every card from its old
 * position and size to its new one, instead of letting cards jump between grid columns.
 */
export function animateBoardLayout(change) {
  const cards = [...document.querySelectorAll("#board .card")];
  const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
  // Apply the new layout immediately (skipping the grid's own transition) so the cards' final spots can be measured.
  const main = document.querySelector("main");
  main.style.transition = "none";
  change();
  for (const c of cards) {
    const a = before.get(c), b = c.getBoundingClientRect();
    if (!b.width || (a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)) continue;
    const from = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    c.animate([{ transformOrigin: "top left", transform: from }, { transformOrigin: "top left", transform: "none" }],
      { duration: 250, easing: "ease" });  // same timing as the panel slide (css/base.css)
  }
  requestAnimationFrame(() => { main.style.transition = ""; });
}

/** Scroll to a game's card and flash it. */
export function highlightCard(key) {
  flash = { key, at: Date.now() };
  renderBoard();
  document.querySelector(`.card[data-key="${key}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** @param {{ onSelectionChanged: () => void }} hooks  called after a card's ✕ unpicks a game */
export function initBoard({ onSelectionChanged }) {
  // Replay the red-zone glow when you come back to this tab.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    for (const key of redZoneShown) glowStart.set(key, Date.now());
    renderBoard();
  });

  // Clicking the truncated last play opens the full text over the card; clicking it (or anywhere else) closes it.
  document.addEventListener("click", (e) => {
    const play = e.target.closest("[data-play]")?.dataset.play ?? null;
    const next = play && play !== openPlay ? play : null;
    if (next === openPlay) return;
    openPlay = next;
    renderBoard();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openPlay) { openPlay = null; renderBoard(); } });

  $("board").addEventListener("click", (e) => {
    if (admin.onBoardClick(e)) return;
    const stats = e.target.closest("[data-stats]")?.dataset.stats;
    if (stats) {
      openStats.has(stats) ? openStats.delete(stats) : openStats.add(stats);
      return renderBoard();
    }
    const key = e.target.closest("[data-remove]")?.dataset.remove;
    if (!key) return;
    state.selected.delete(key);
    saveSelected();
    onSelectionChanged();
  });
}
