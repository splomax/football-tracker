// The devices that turned on notifications (phones and computers), kept in Workers KV (the PUSH namespace,
// wrangler.toml) so they survive deploys: each under "phone:" + a hash of its push address, as { subscription, bells,
// public, kinds?, at }. bells are that device's lit games (each device has its own). kinds are the kinds of
// notification an admin chose on that device for each game ({ key: kinds }, js/alerts.js NOTIFY_KINDS); a game without
// them, the defaults. public marks a device no admin turned on;
// test notifications skip those (devices saved before there was a public sign-in have no mark, and were all admins').
// sendToPhones sends a notification (worker/webpush.js) and forgets a device its push service says is gone.

import { sendPush } from "./webpush.js";

export const SUBJECT = "mailto:sean@gametrackerlive.com";  // who to contact about our pushes, for the push services

async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return "phone:" + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const validSubscription = (s) => typeof s?.endpoint === "string" && s.endpoint.startsWith("https://")
  && typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";
const validKinds = (byGame) => !!byGame && typeof byGame === "object" && !Array.isArray(byGame) && Object.keys(byGame).length <= 500
  && Object.entries(byGame).every(([key, k]) => key.length < 40 && Array.isArray(k) && k.length <= 50 && k.every((x) => typeof x === "string" && x.length < 30));
const validBells = (b) => Array.isArray(b) && b.length <= 500 && b.every((k) => typeof k === "string" && k.length < 40);

/**
 * Save a phone (or update it). An admin's device keeps the kinds it chose (sent along, or saved before); a tester keeps
 * being one (set by hand in KV: "tester": true, so the admin's test notifications reach it too). False if what was sent
 * isn't a subscription and list of bells.
 */
export async function savePhone(kv, subscription, bells, now = Date.now(), admin = false, kinds = undefined) {
  if (!validSubscription(subscription) || !validBells(bells)) return false;
  const { endpoint, keys } = subscription;
  const key = await keyFor(endpoint);
  const old = await kv.get(key, "json");
  const chosen = admin ? (validKinds(kinds) ? kinds : old?.kinds) : undefined;
  await kv.put(key, JSON.stringify({ subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, bells, public: !admin,
    ...(chosen && { kinds: chosen }), ...(old?.tester && { tester: true }), at: now }));
  return true;
}

/** An admin's device choosing which kinds of notification it gets for each game ({ key: kinds }). False if the phone isn't saved (or bad kinds). */
export async function setKinds(kv, endpoint, kinds, now = Date.now()) {
  if (typeof endpoint !== "string" || !validKinds(kinds)) return false;
  const key = await keyFor(endpoint);
  const phone = await kv.get(key, "json");
  if (!phone) return false;
  await kv.put(key, JSON.stringify({ ...phone, kinds, public: false, at: now }));
  return true;
}

/** Change a saved phone's bells. False if the phone isn't saved (or the bells aren't a list). */
export async function setBells(kv, endpoint, bells, now = Date.now(), admin = false) {
  if (typeof endpoint !== "string" || !validBells(bells)) return false;
  const key = await keyFor(endpoint);
  const phone = await kv.get(key, "json");
  if (!phone) return false;
  await kv.put(key, JSON.stringify({ ...phone, bells, ...(admin && { public: false }), at: now }));
  return true;
}

export async function removePhone(kv, endpoint) {
  if (typeof endpoint === "string") await kv.delete(await keyFor(endpoint));
}

/** Every saved phone: [{ subscription, bells, public, kinds?, tester?, at }]. */
export async function listPhones(kv) {
  const phones = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: "phone:", cursor });
    for (const { name } of page.keys) {
      const phone = await kv.get(name, "json");
      if (phone) phones.push(phone);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return phones;
}

/**
 * Send `message` ({ title, body, key, icon? }) to `phones` (every saved phone if left out). A phone whose push service
 * answers 404 or 410 has gone and is forgotten. Resolves with { sent, gone }: how many were sent, and the gone ones'
 * endpoints (so a caller holding its own list can drop them).
 */
export async function sendToPhones(env, message, phones) {
  if (!env.PUSH || !env.VAPID_PRIVATE_KEY) return { sent: 0, gone: [] };
  const vapid = { privateJwk: JSON.parse(env.VAPID_PRIVATE_KEY), subject: SUBJECT };
  let sent = 0;
  const gone = [];
  for (const phone of phones ?? await listPhones(env.PUSH)) {
    try {
      const status = await sendPush(phone.subscription, message, vapid);
      if (status === 404 || status === 410) {
        await removePhone(env.PUSH, phone.subscription.endpoint);
        gone.push(phone.subscription.endpoint);
      } else if (status >= 200 && status < 300) sent++;
      else console.error("push", status, new URL(phone.subscription.endpoint).origin);
    } catch (err) {
      console.error("push", err);
    }
  }
  return { sent, gone };
}
