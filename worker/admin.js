// The admin's extra controls, served only to a logged-in admin by the Worker (worker/index.js) and loaded by
// js/admin.js. It runs from a blob: URL, so it can't import the app's modules; install() is handed what it needs.
//
// - "Enable notifications" in the gear menu, which puts a bell on every card and on each picked game's row in the game
//   list, where a lit one shows at a glance. A lit bell gets desktop notifications for that game while this page is
//   open. The backend works out what's news (worker/hub.js, js/alerts.js) and hands it over with the games (onAlerts).
//   Each card also gets a test button, which sends that game a notification through the backend.
// - The visit counter's weekly, monthly and total counts atop the gear menu, fetched each time it opens.
// - In the game list, a row of bulk buttons atop each section: Live, Upcoming and Final get "Select all" (every game
//   the section shows) and "Remove all" (that state's picked games, which sit under Selected); Selected gets
//   "Remove all" (every picked game in the current tab and filters).

let app;  // { renderBoard, renderList, listView, state, saveSelected, visits, store, highlightCard, testAlert } from js/admin.js

/** Returns the hooks for js/board.js's setAdmin. */
export function install(appApi) {
  app = appApi;
  app.store.set("hiddenGames", null);  // left behind by two hide features since removed
  app.store.set("hiddenFromList", null);
  addNotifyToggle();
  addVisits();
  return {
    groupExtras,
    rowExtras: (g) => (notifying() && app.state.selected.has(g.key) ? bellButton(g, "row-bell") : ""),
    onListClick(e) {
      const bellKey = e.target.closest("[data-bell]")?.dataset.bell;
      if (bellKey) { e.preventDefault(); toggleBell(bellKey); return true; }  // preventDefault: the row's label stays put
      const button = e.target.closest("[data-bulk]");
      if (!button) return false;
      const add = button.dataset.bulk === "add";
      bulkGames(button.dataset.group, add).forEach((g) => (add ? app.state.selected.add(g.key) : app.state.selected.delete(g.key)));
      app.saveSelected();
      app.renderList();
      app.renderBoard();
      return true;
    },
    // Left of the ✕ and styled like it, with notifications on: the bell, then the test button.
    cardExtras: (g) => (notifying() ? bellButton(g) + testButton(g) : ""),
    onAlerts,
    onBoardClick(e) {
      const bellKey = e.target.closest("[data-bell]")?.dataset.bell;
      if (bellKey) { toggleBell(bellKey); return true; }
      const testKey = e.target.closest("[data-test-alert]")?.dataset.testAlert;
      if (testKey) { app.testAlert(testKey); return true; }
      return false;
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
    app.renderList();
  });
  document.getElementById("google-me").before(button);
}

function bellButton(g, kind = "bell") {
  const on = belled().has(g.key);
  const label = on ? "Stop notifications for this game" : "Notify me about this game";
  return `<button type="button" class="${kind} ${on ? "on" : ""}" data-bell="${g.key}" aria-pressed="${on}" aria-label="${label}" title="${label}">${BELL_ICON}</button>`;
}

// Only picked games keep a bell, so one that's been removed from the board doesn't linger in the list.
function toggleBell(key) {
  const keys = belled();
  keys.has(key) ? keys.delete(key) : keys.add(key);
  app.store.set("notifyGames", [...keys].filter((k) => app.state.selected.has(k)));
  app.renderBoard();
  app.renderList();
}

// Notifications from the backend's feed: those for picked games with a lit bell, and any test (forced) notification.
function onAlerts(alerts) {
  if (!notifying()) return;
  const keys = belled();
  for (const a of alerts) if (a.forced || (keys.has(a.key) && app.state.selected.has(a.key))) show(a, a.key);
}

// A paper plane: send this game a test notification through the backend.
const PLANE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>`;

function testButton(g) {
  return `<button type="button" class="test-alert" data-test-alert="${g.key}" aria-label="Send a test notification" title="Send a test notification">${PLANE}</button>`;
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
