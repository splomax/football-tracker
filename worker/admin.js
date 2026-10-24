// The admin's extra controls, served only to a logged-in admin by the Worker (worker/index.js) and loaded by
// js/admin.js. It runs from a blob: URL, so it can't import the app's modules; install() is handed what it needs.
//
// - On each card (on a computer), a paper-plane button that sends that game a test notification through the program on
//   Cloudflare, to the admins' devices whose bell for that game is lit (everyone's bells are in js/notify.js), and
//   beside it a chooser for which kind: a plain test, or a sample touchdown, red zone, halftime... for styling them.
// - "Scores from:" atop the gear menu: whether this page's last update came from the program on Cloudflare
//   (worker/scorekeeper.js), which the admin's pages use, or from ESPN directly because the program couldn't be reached.
// - The visit counter's weekly, monthly and total counts atop the gear menu, fetched each time it opens.
// - In the game list, a row of bulk buttons atop each section: Live, Upcoming and Final get "Select all" (every game
//   the section shows) and "Remove all" (that state's picked games, which sit under Selected); Selected gets
//   "Remove all" (every picked game in the current tab and filters).

let app;  // { renderBoard, renderList, listView, state, saveSelected, visits, store, lastSource, testAlert, sampleKinds } from js/admin.js

/** Returns the hooks for js/board.js's setAdmin. */
export function install(appApi) {
  app = appApi;
  document.addEventListener("change", (e) => {
    if (!e.target.matches?.(".test-kind")) return;
    app.store.set("testKind", e.target.value);
    e.target.blur();
    app.renderBoard();
  });
  app.store.set("hiddenGames", null);  // left behind by two hide features since removed
  app.store.set("hiddenFromList", null);
  app.store.set("notify", null);  // the old Enable notifications switch, since removed
  addVisits();
  addScoreSource();
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
    // Left of the bell and styled like it: the test button and its chooser.
    cardExtras: (g) => testButton(g) + kindChooser(g),
    onBoardClick(e) {
      const testKey = e.target.closest("[data-test-alert]")?.dataset.testAlert;
      if (testKey) { app.testAlert(testKey, app.store.get("testKind", "test")); return true; }
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

// Gear menu: where this page's scores came from at the last update, under the visit counts, checked whenever the menu
// opens.
const SOURCES = { server: "Game Tracker server", espn: "ESPN", "espn-fallback": "ESPN (server unreachable)" };
function addScoreSource() {
  const visits = document.getElementById("visits");
  if (!visits || document.getElementById("score-source")) return;
  const row = document.createElement("div");
  row.id = "score-source";
  visits.after(row);
  const refresh = () => { row.textContent = `Scores from: ${SOURCES[app.lastSource()] ?? "…"}`; };
  refresh();
  const gear = document.getElementById("settings");
  gear.addEventListener("click", () => { if (gear.getAttribute("aria-expanded") === "true") refresh(); });
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

// A paper plane: send this game a test notification through the program on Cloudflare.
const PLANE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>`;

// Which kind the test button sends, remembered; a native dropdown drawn as a chevron. Choosing lets go of it, so the
// board's redraws (which wait while it's open, js/board.js) carry on.
function kindChooser(g) {
  const chosen = app.store.get("testKind", "test");
  const options = Object.entries(app.sampleKinds).map(([kind, label]) => `<option value="${kind}" ${kind === chosen ? "selected" : ""}>${label}</option>`).join("");
  return `<select class="test-kind" data-game="${g.key}" aria-label="Kind of test notification" title="Kind of test notification: ${app.sampleKinds[chosen]}">${options}</select>`;
}

function testButton(g) {
  return `<button type="button" class="test-alert" data-test-alert="${g.key}" aria-label="Send a test notification" title="Send a test notification">${PLANE}</button>`;
}
