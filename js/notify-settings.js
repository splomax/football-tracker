// Each game's notification settings: on a card whose bell is on, a sliders button opening which kinds of notification
// this device gets for that game (a touchdown, a lead change, a turnover, the two-minute warning...), saved here and on
// the server (js/push.js sendKinds, worker/phones.js). A game never set gets the defaults (js/alerts.js DEFAULT_KINDS).
// Shown with ?notification-settings in the address, and to admins (js/admin.js).

import { NOTIFY_SETTINGS } from "./config.js";
import { store } from "./store.js";
import { state, allGames } from "./state.js";
import { NOTIFY_KINDS, DEFAULT_KINDS } from "./alerts.js";
import { sendKinds } from "./push.js";

let on = NOTIFY_SETTINGS;

/** Show the settings buttons (an admin's page). */
export const enableNotifySettings = () => { on = true; };

const SLIDERS = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>`;

/** A card's sliders button (css/board.css hides it while the bell is off), or nothing when the settings aren't on. */
export function kindsButton(g) {
  return on ? `<button type="button" class="notify-kinds" data-kinds="${g.key}" aria-label="Notification settings for this game" title="Notification settings for this game">${SLIDERS}</button>` : "";
}

/** A click on the board: opens the settings when it was a sliders button. True if it was. */
export function onBoardKinds(e) {
  const key = e.target.closest("[data-kinds]")?.dataset.kinds;
  if (key) openNotifySettings(key);
  return !!key;
}

// Each game's chosen kinds, by game key; only picked games' are kept.
const chosenKinds = () => {
  const saved = store.get("notifyKinds");
  return saved && !Array.isArray(saved) && typeof saved === "object" ? saved : {};
};

// A dialog of switches, one per kind of notification, grouped, for one game. Each change is saved right away (and sent
// to the server once this device has notifications on).
function openNotifySettings(key) {
  const g = allGames().find((x) => x.key === key);
  const chosen = new Set(chosenKinds()[key] ?? DEFAULT_KINDS);
  const dialog = document.createElement("dialog");
  dialog.id = "notify-settings";
  // On phones (css/mobile.css) it's a sheet from the bottom: Done up top beside the title, and switches in place of
  // checkboxes.
  dialog.innerHTML = `<form method="dialog">
    <div class="sheet-head">
      <div><label>Notification settings</label>
      <p class="note">What this device gets for ${g ? `${g.away.name || g.away.abbr} @ ${g.home.name || g.home.abbr}` : "this game"} while its bell is on.</p></div>
      <button value="ok" class="done-top">Done</button>
    </div>
    ${NOTIFY_KINDS.map(([group, kinds]) => `<fieldset><legend>${group}</legend>${Object.entries(kinds).map(([kind, label]) =>
      `<label class="kind"><input type="checkbox" value="${kind}" ${chosen.has(kind) ? "checked" : ""}><span>${label}</span></label>`).join("")}</fieldset>`).join("")}
    <div class="buttons"><button value="ok">Done</button></div>
  </form>`;
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });  // a tap outside it
  dialog.addEventListener("change", () => {
    const all = { ...chosenKinds(), [key]: [...dialog.querySelectorAll("input:checked")].map((i) => i.value) };
    sendKinds(Object.fromEntries(Object.entries(all).filter(([k]) => state.selected.has(k))));
  });
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  dialog.scrollTop = 0;  // on a short screen it scrolls; open at the top, not at whatever got focus
}
