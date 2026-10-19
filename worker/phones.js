// The phones that turned on notifications, kept in Workers KV (the PUSH namespace, wrangler.toml) so they survive
// deploys: each under "phone:" + a hash of its push address, as { subscription, bells, admin, at }. bells are that
// phone's lit games (each device has its own); admin marks a phone saved by a logged-in admin, the only ones that get
// test notifications. sendToPhones sends a notification (worker/webpush.js) and forgets a phone its
// push service says is gone.

import { sendPush } from "./webpush.js";

export const SUBJECT = "mailto:sean@gametrackerlive.com";  // who to contact about our pushes, for the push services

async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return "phone:" + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const validSubscription = (s) => typeof s?.endpoint === "string" && s.endpoint.startsWith("https://")
  && typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";
const validBells = (b) => Array.isArray(b) && b.length <= 500 && b.every((k) => typeof k === "string" && k.length < 40);

/** Save a phone (or update it). False if what was sent isn't a subscription and list of bells. */
export async function savePhone(kv, subscription, bells, now = Date.now(), admin = false) {
  if (!validSubscription(subscription) || !validBells(bells)) return false;
  const { endpoint, keys } = subscription;
  await kv.put(await keyFor(endpoint), JSON.stringify({ subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, bells, admin, at: now }));
  return true;
}

/** Change a saved phone's bells. False if the phone isn't saved (or the bells aren't a list). */
export async function setBells(kv, endpoint, bells, now = Date.now(), admin = false) {
  if (typeof endpoint !== "string" || !validBells(bells)) return false;
  const key = await keyFor(endpoint);
  const phone = await kv.get(key, "json");
  if (!phone) return false;
  await kv.put(key, JSON.stringify({ ...phone, bells, admin: phone.admin || admin, at: now }));
  return true;
}

export async function removePhone(kv, endpoint) {
  if (typeof endpoint === "string") await kv.delete(await keyFor(endpoint));
}

/** Every saved phone: [{ subscription, bells, admin, at }]. */
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
