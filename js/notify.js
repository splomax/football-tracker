// Notifications, for everyone: a bell on every card (shown on hover with a mouse) and on every game's row in the game
// list. Lighting one asks the browser's permission the first time, then hands this device's subscription and lit
// bells to the server (js/push.js, worker/phones.js), which pushes that game's scores, red-zone trips, two-minute
// warnings and quarters even while the page is closed. Lighting an unpicked game's row bell picks the game too.
//
// Where push can't work, lighting a bell explains instead: on an iPhone in Safari (notifications need the Home Screen
// app, so a step-by-step walkthrough, also in the gear menu), in a browser without push, or once notifications have
// been blocked. Blocking them later (in the browser, or iPhone Settings) is noticed whenever the page opens or comes
// back: the bells show off and a note says how to unblock (once per block); unblocking turns them back on.

import { store } from "./store.js";
import { state, saveSelected, onSelectionSaved } from "./state.js";
import { needsInstall, pushApplies, turnOn, sendBells, showHere } from "./push.js";

const BELL_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0"/></svg>`;

const belled = () => new Set(store.get("notifyGames", []));
// Notifications were on here, but the browser no longer allows them. The lit bells are kept for when they're allowed again.
const blocked = () => store.get("pushOn", false) && window.Notification?.permission !== undefined && Notification.permission !== "granted";
let redraw = () => {};  // the board and the game list, after a row bell picks a game (initNotify)

/** A game's bell: "bell" on its card, "row-bell" on its game-list row. */
export function bellButton(g, kind = "bell") {
  const on = belled().has(g.key) && !blocked();
  const label = on ? "Stop notifications for this game" : "Notify me about this game";
  return `<button type="button" class="${kind} ${on ? "on" : ""}" data-bell="${g.key}" aria-pressed="${on}" aria-label="${label}" title="${label}">${BELL_ICON}</button>`;
}

/** A click on the board: a card's bell. True if it was one. */
export function onBoardBell(e) {
  const key = e.target.closest("[data-bell]")?.dataset.bell;
  if (!key) return false;
  toggleBell(key);
  return true;
}

/** A click in the game list: a row's bell, which picks an unpicked game and lights its bell. True if it was one. */
export function onListBell(e) {
  const key = e.target.closest("[data-bell]")?.dataset.bell;
  if (!key) return false;
  e.preventDefault();  // the row's label stays put; picking is done here
  if (state.selected.has(key)) {
    toggleBell(key);
    return true;
  }
  if (!belled().has(key) || blocked()) {
    toggleBell(key).then((lit) => {
      if (!lit) return;
      state.selected.add(key);
      saveSelected();
      redraw();
    });
  }
  return true;
}

// Light or unlight a game's bell. Lighting checks the device can get notifications first (asking permission the first
// time); resolves whether it's lit. Only picked games keep a bell. The bells change in place: redrawing the board
// would replace the card under the mouse, and its hover buttons would blink out until the mouse moved again.
async function toggleBell(key) {
  const keys = belled();
  const wasBlocked = blocked();
  const lighting = !keys.has(key) || wasBlocked;  // a blocked bell shows off, so a tap means "on"
  if (lighting && !(await canNotify())) return false;
  lighting ? keys.add(key) : keys.delete(key);
  const lit = [...keys].filter((k) => state.selected.has(k) || k === key);
  store.set("notifyGames", lit);
  if (wasBlocked) {  // allowed again from the bell: every kept bell is back
    resume(lit);
    return true;
  }
  for (const b of document.querySelectorAll(`[data-bell="${key}"]`)) {
    const label = lighting ? "Stop notifications for this game" : "Notify me about this game";
    b.classList.toggle("on", lighting);
    b.setAttribute("aria-pressed", lighting);
    b.setAttribute("aria-label", label);
    b.title = label;
  }
  // The server needs this device and its bells; the first time, it subscribes, and a notification confirms it works
  // (if that one never shows, the system is blocking the browser: on a Mac, System Settings > Notifications).
  if (!store.get("pushOn", false)) {
    if (!(await turnOn(lit).catch(() => false))) {
      say("Couldn't turn on notifications", "Something went wrong reaching the Game Tracker server. Try again in a moment.");
      return lighting;
    }
    store.set("pushOn", true);
    showHere("Notifications are on", { body: "You'll get scores, red-zone trips, two-minute warnings and quarters for the games you ring.", icon: "images/notification-icon.png" });
  } else {
    sendBells(lit);
  }
  return lighting;
}

// Whether this device can get notifications, asking the browser's permission if it hasn't been asked; explains when not.
async function canNotify() {
  if (needsInstall()) {
    explainInstall();
    return false;
  }
  if (!pushApplies() || !window.Notification) {
    say("Notifications aren't available here", "This browser can't get notifications. Try Chrome, or on an iPhone, the Game Tracker Home Screen app.");
    return false;
  }
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission === "granted") return true;
  if (permission === "denied") say("Notifications are blocked", `${UNBLOCK()}, then tap the bell again.`);
  return false;
}

// How to allow notifications again, on this device: iPhone Settings, Android Chrome's site menu, or a computer's.
const UNBLOCK = () => (/iPhone|iPad/.test(navigator.userAgent)
  ? "Turn them on in Settings → Notifications → Game Tracker"
  : /Android/i.test(navigator.userAgent)
    ? "Tap the icon left of the address, then Permissions → Notifications → Allow"
    : "Turn them on from the icon left of the address (Site settings → Notifications → Allow)");

// Notifications allowed again after a block: subscribe anew (the old subscription may have lapsed, and the server
// forgets a device whose pushes bounce) and show the kept bells lit.
function resume(lit) {
  store.set("blockNoted", false);
  turnOn(lit).catch(() => {});
  redraw();
}

// Whenever the page opens or comes back: has the browser stopped allowing notifications (say once per block, and show
// the bells off), or started again (bring them back)?
function checkPermission() {
  if (!store.get("pushOn", false)) return;
  if (blocked()) {
    if (!store.get("blockNoted", false)) {
      store.set("blockNoted", true);
      say("Notifications are blocked", `Game Tracker can't send notifications here anymore. ${UNBLOCK()}. Your bells are kept for when they're back.`);
    }
    redraw();
  } else if (store.get("blockNoted", false)) {
    resume([...belled()].filter((k) => state.selected.has(k)));
  }
}

// Deselecting a game (its card's ✕, the game list, Remove all) turns its bell off too, at the server as well.
function dropUnpickedBells() {
  const keys = belled();
  const lit = [...keys].filter((k) => state.selected.has(k));
  if (lit.length === keys.size) return;
  store.set("notifyGames", lit);
  if (store.get("pushOn", false)) sendBells(lit);
}

// A small dialog with a title, a line of text and OK.
function say(title, text) {
  const dialog = document.createElement("dialog");
  dialog.id = "install-help";
  dialog.innerHTML = `<form method="dialog"><label>${title}</label><p class="step">${text}</p>
    <div class="buttons"><button value="ok" autofocus>OK</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

// iPhone only (needsInstall() is false on Android and laptops): iPhones only allow notifications from an app on the
// Home Screen, so this walks through adding it, one step at a time. Opened by a bell in Safari, or the gear menu's
// "Get notifications on iPhone".
const INSTALL_STEPS = [
  "Tap <b>⋯</b> at the bottom right of Safari, next to the address, then tap <b>Share</b>.",
  "Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.",
  "Open Game Tracker from your Home Screen, tap a game's bell, then <b>Allow</b>.",
];

function explainInstall() {
  const dialog = document.createElement("dialog");
  dialog.id = "install-help";
  let step = 0;
  const render = () => {
    const last = step === INSTALL_STEPS.length - 1;
    dialog.innerHTML = `<form method="dialog">
      <label>Notifications on iPhone</label>
      ${step === 0 ? `<p class="note">iPhones only allow notifications from apps on the Home Screen. Here's how to add Game Tracker.</p>` : ""}
      <p class="step-count">Step ${step + 1} of ${INSTALL_STEPS.length}</p>
      <p class="step">${INSTALL_STEPS[step]}</p>
      <div class="buttons">
        ${step > 0 ? `<button type="button" data-step="-1">Back</button>` : `<button value="cancel">Not now</button>`}
        ${last ? `<button value="ok" autofocus>Done</button>` : `<button type="button" value="ok" data-step="1" autofocus>Next</button>`}
      </div>
    </form>`;
  };
  render();
  dialog.addEventListener("click", (e) => {
    const move = e.target.closest("[data-step]")?.dataset.step;
    if (move) { step += Number(move); render(); dialog.querySelector("[autofocus]").focus(); }
  });
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

/** @param {{ redraw: () => void }} hooks  redraw: the board and the game list */
export function initNotify(hooks) {
  redraw = hooks.redraw;
  onSelectionSaved(dropUnpickedBells);
  checkPermission();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkPermission(); });
  // The gear menu's "Get notifications on iPhone", in Safari on an iPhone only.
  if (needsInstall()) {
    const button = document.createElement("button");
    button.id = "install-help-item";
    button.innerHTML = `<span class="check"></span>Get notifications on iPhone`;
    button.addEventListener("click", explainInstall);
    document.getElementById("google-me").before(button);
  }
}
