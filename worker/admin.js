// The admin's extra controls, served only to a logged-in admin by the Worker (worker/index.js) and loaded by
// js/admin.js. It runs from a blob: URL, so it can't import the app's modules; install() is handed what it needs.
//
// - A share button on live cards, which links to ?game=league:id (js/config.js's LINKED_GAMES).
// - "Enable notifications" in the gear menu, which puts a bell on every card. A lit bell gets desktop notifications
//   for that game (js/alerts.js says what's news), while this page is open.
// - The visit counter's weekly, monthly and total counts atop the gear menu, fetched each time it opens.
// - In the game list, a row of bulk buttons atop each section: Live, Upcoming and Final get "Select all" (every game
//   the section shows) and "Remove all" (that state's picked games, which sit under Selected); Selected gets
//   "Remove all" (every picked game in the current tab and filters).

let app;  // { renderBoard, renderList, listView, allGames, state, saveSelected, visits, store, highlightCard, gameAlerts } from js/admin.js

/** Returns the hooks for js/board.js's setAdmin. */
export function install(appApi) {
  app = appApi;
  addNotifyToggle();
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
    cardExtras: (g) => (g.state === "in" ? shareButton(g) : "") + (notifying() ? bellButton(g) : ""),
    onPoll,
    onBoardClick(e) {
      const bellKey = e.target.closest("[data-bell]")?.dataset.bell;
      if (bellKey) { toggleBell(bellKey); return true; }
      const shareKey = e.target.closest("[data-share]")?.dataset.share;
      const game = shareKey && app.allGames().find((g) => g.key === shareKey);
      if (!game) return false;
      share(game);
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

// Notifications. "Enable notifications" asks the browser's permission and, once given, sends a test notification:
// if that one doesn't show up, the browser allowed it but the system blocked it (on a Mac: System Settings >
// Notifications > Google Chrome, or a Focus mode). They only come while this page is open; a background tab polls
// less often, so they can be up to a minute late there.
const BELL_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0"/></svg>`;
const lastSeen = new Map();  // game key -> the game at the last poll
const memos = new Map();     // game key -> js/alerts.js's memo

const notifying = () => app.store.get("notify", false) && window.Notification?.permission === "granted";
const belled = () => new Set(app.store.get("notifyGames", []));

function addNotifyToggle() {
  const menu = document.getElementById("settings-menu");
  if (!menu || document.getElementById("notify")) return;
  const button = document.createElement("button");
  button.id = "notify";
  const label = (text) => { button.innerHTML = `<span class="check">✓</span>${text}`; };
  label("Enable notifications");
  button.setAttribute("aria-pressed", notifying());
  button.addEventListener("click", async () => {
    if (notifying()) {
      app.store.set("notify", false);
    } else if (!window.Notification) {
      return label("Notifications unsupported");
    } else if (await Notification.requestPermission() !== "granted") {
      return label("Notifications blocked");  // the browser's site settings can unblock them
    } else {
      app.store.set("notify", true);
      show({ title: "Notifications are on", body: "Click a game's bell to get its scores, red-zone trips, two-minute warnings and quarters." });
    }
    button.setAttribute("aria-pressed", notifying());
    app.renderBoard();
  });
  document.getElementById("google-me").before(button);
}

function bellButton(g) {
  const on = belled().has(g.key);
  const label = on ? "Stop notifications for this game" : "Notify me about this game";
  return `<button class="bell ${on ? "on" : ""}" data-bell="${g.key}" aria-pressed="${on}" aria-label="${label}" title="${label}">${BELL_ICON}</button>`;
}

// Only picked games keep a bell, so one that's been removed from the board doesn't linger in the list.
function toggleBell(key) {
  const keys = belled();
  keys.has(key) ? keys.delete(key) : keys.add(key);
  app.store.set("notifyGames", [...keys].filter((k) => app.state.selected.has(k)));
  app.renderBoard();
}

// Every game is followed, bell or not, so lighting a bell mid-game doesn't bring old news.
function onPoll(games) {
  const on = notifying(), keys = belled();
  for (const g of games) {
    if (!memos.has(g.key)) memos.set(g.key, {});
    const alerts = app.gameAlerts(lastSeen.get(g.key), g, memos.get(g.key));
    lastSeen.set(g.key, g);
    if (on && keys.has(g.key) && app.state.selected.has(g.key)) alerts.forEach((a) => show(a, g.key));
  }
}

// Clicking one brings this tab forward with the game's card highlighted. A tag replaces the earlier notification with
// that tag (a touchdown's, by its extra point); renotify alerts again unless it's meant to be silent.
function show({ title, body, tag, silent = false }, key) {
  const n = new Notification(title, { body, icon: "images/apple-touch-icon.png", silent, ...(tag && { tag, renotify: !silent }) });
  n.onclick = () => {
    window.focus();
    if (key) app.highlightCard(key);
    n.close();
  };
}
