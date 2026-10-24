// The admin's extra controls, served only to a logged-in admin by the Worker (worker/index.js) and loaded by
// js/admin.js. It runs from a blob: URL, so it can't import the app's modules; install() is handed what it needs.
//
// - On each card (on a computer), a paper-plane button that sends that game a test notification through the program on
//   Cloudflare, to the admins' devices whose bell for that game is lit (everyone's bells are in js/notify.js), and
//   beside it a chooser for which kind: a plain test, or a sample touchdown, field goal, halftime... for styling them.
// - "Notification settings" in the gear menu: which kinds of notification this device gets (a touchdown, a lead
//   change, a turnover, the two-minute warning...), saved here and on the server (worker/phones.js). Everyone else's
//   devices get the defaults (js/alerts.js DEFAULT_KINDS).
// - "Scores from:" atop the gear menu: whether this page's last update came from the program on Cloudflare
//   (worker/scorekeeper.js), which the admin's pages use, or from ESPN directly because the program couldn't be reached.
// - The visit counter's weekly, monthly and total counts atop the gear menu, fetched each time it opens.
// - In the game list, the bulk buttons atop each section (Select all, Remove all) always, not only while Top 25 or a
//   conference narrows the list (js/picker.js).

let app;  // { renderBoard, renderList, state, saveSelected, visits, store, lastSource, testAlert, sampleKinds, notifyKinds,
          //   defaultKinds, sendKinds } from js/admin.js

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
  addNotifySettings();
  return {
    bulkAlways: true,
    // Left of the bell and styled like it: the test button and its chooser.
    cardExtras: (g) => testButton(g) + kindChooser(g),
    onBoardClick(e) {
      const testKey = e.target.closest("[data-test-alert]")?.dataset.testAlert;
      if (testKey) { app.testAlert(testKey, app.store.get("testKind", "test")); return true; }
      return false;
    },
  };
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

// Gear menu: "Notification settings", a dialog of switches, one per kind of notification, grouped. Each change is saved
// right away (and sent to the server once this device has notifications on).
function addNotifySettings() {
  if (document.getElementById("notify-settings-item")) return;
  const item = document.createElement("button");
  item.id = "notify-settings-item";
  item.innerHTML = `<span class="check"></span>Notification settings`;
  item.addEventListener("click", openNotifySettings);
  document.getElementById("save-board").before(item);
}

function openNotifySettings() {
  const chosen = new Set(app.store.get("notifyKinds") ?? app.defaultKinds);
  const dialog = document.createElement("dialog");
  dialog.id = "notify-settings";
  dialog.innerHTML = `<form method="dialog">
    <label>Notification settings</label>
    <p class="note">What this device gets for the games you ring.</p>
    ${app.notifyKinds.map(([group, kinds]) => `<fieldset><legend>${group}</legend>${Object.entries(kinds).map(([kind, label]) =>
      `<label class="kind"><input type="checkbox" value="${kind}" ${chosen.has(kind) ? "checked" : ""}>${label}</label>`).join("")}</fieldset>`).join("")}
    <div class="buttons"><button value="ok">Done</button></div>
  </form>`;
  dialog.addEventListener("change", () => {
    app.sendKinds([...dialog.querySelectorAll("input:checked")].map((i) => i.value));
  });
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  dialog.scrollTop = 0;  // on a short screen it scrolls; open at the top, not at whatever got focus
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
