// Phone notifications (iPhone first). An iPhone only lets a website send notifications once it's added to the Home
// Screen (manifest.webmanifest) and opened from there. Turning them on there subscribes this phone with our public key
// and hands the subscription, plus this phone's lit bells, to the server (worker/phones.js), which then sends
// notifications through Apple even while the app is closed; the service worker (sw.js) shows them. Admin-only for now:
// js/admin.js hands these to the admin module, which drives them from its Enable notifications switch and bells.

import { ADMIN_URL } from "./config.js";
import { store } from "./store.js";

// Our VAPID public key: phones subscribe with it, and only our private key (the VAPID_PRIVATE_KEY Worker secret) can
// sign the pushes it accepts.
const PUBLIC_KEY = "BNg8ZFuXpwXPpc1xKukHs9yqwRgXv3MM3my45jvG87kE8c9e73Bp_QRfVrrwcq-A0GMOwAA2G-cSe0Bnx10tOBw";

/** Register sw.js, once the admin features are on. Quietly does nothing where service workers aren't available. */
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

/** Whether this is where phone notifications apply: the installed app, with push available. Laptops keep theirs in the page. */
export const pushApplies = () => installedApp() && "serviceWorker" in navigator && "PushManager" in window;

const post = (path, body) => fetch(`${ADMIN_URL}/push/${path}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${store.get("adminToken")}`, "Content-Type": "application/json" },
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
  return (await post("subscribe", { subscription: sub.toJSON(), bells })).ok;
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

/** Show a notification on this device: through the service worker in the installed app (iOS has no other way). */
export async function showHere(title, options) {
  const reg = await navigator.serviceWorker.ready;
  return reg.showNotification(title, options);
}
