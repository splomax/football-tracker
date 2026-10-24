// Notifications, pushed by the server. Lighting a bell (js/notify.js) subscribes this device with our public key and
// hands the subscription, plus its lit bells, to the server (worker/phones.js), which then sends notifications through
// Apple, Google or Mozilla even while the page is closed; the service worker (sw.js) shows them. Computers and Android
// get them from any browser tab; an iPhone only once the site is added to the Home Screen (manifest.webmanifest) and
// opened from there.

import { ADMIN_URL } from "./config.js";
import { store } from "./store.js";

// Our VAPID public key: phones subscribe with it, and only our private key (the VAPID_PRIVATE_KEY Worker secret) can
// sign the pushes it accepts.
const PUBLIC_KEY = "BNg8ZFuXpwXPpc1xKukHs9yqwRgXv3MM3my45jvG87kE8c9e73Bp_QRfVrrwcq-A0GMOwAA2G-cSe0Bnx10tOBw";

/** Register sw.js, at startup. Quietly does nothing where service workers aren't available. */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("service worker", err);
    return null;
  }
}

/** Running as an app opened from the Home Screen, not in a browser tab. */
export const installedApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** An iPhone or iPad (iPads report themselves as Macs, but with a touch screen). */
const iOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** On an iPhone, but in Safari rather than the Home Screen app, where notifications can't be turned on. */
export const needsInstall = () => iOS() && !installedApp();

/** Whether this browser can get pushed notifications (an iPhone only in the Home Screen app: needsInstall). */
export const pushApplies = () => "serviceWorker" in navigator && "PushManager" in window;

// An admin's login goes along, so the server marks an admin's devices (they get test notifications).
const post = (path, body) => fetch(`${ADMIN_URL}/push/${path}`, {
  method: "POST",
  headers: { ...(store.get("adminToken") && { Authorization: `Bearer ${store.get("adminToken")}` }), "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function subscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Subscribe this phone and hand the server its subscription and bells. Resolves true once the server has it. */
export async function turnOn(bells) {
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: PUBLIC_KEY });
  // An admin's chosen kinds for each game go along; the server ignores them from anyone else.
  return (await post("subscribe", { subscription: sub.toJSON(), bells, kinds: store.get("notifyKinds") ?? undefined })).ok;
}

/** Stop this phone's notifications, on the server and on the phone. */
export async function turnOff() {
  const sub = await subscription().catch(() => null);
  if (!sub) return;
  await post("unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Tell the server this phone's lit bells changed. */
export async function sendBells(bells) {
  const sub = await subscription().catch(() => null);
  if (sub) await post("bells", { endpoint: sub.endpoint, bells }).catch(() => {});
}

/** An admin's device choosing which kinds of notification it gets, by game ({ key: kinds }, js/alerts.js NOTIFY_KINDS). Saved here too. */
export async function sendKinds(kinds) {
  store.set("notifyKinds", kinds);
  const sub = await subscription().catch(() => null);
  if (sub) await post("kinds", { endpoint: sub.endpoint, kinds }).catch(() => {});
}

/** Show a notification on this device, through the service worker (phones have no other way). */
export async function showHere(title, options) {
  const reg = await navigator.serviceWorker.ready;
  return reg.showNotification(title, options);
}
