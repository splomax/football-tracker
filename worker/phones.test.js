// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { savePhone, setBells, removePhone, listPhones, sendToPhones } from "./phones.js";

// An in-memory stand-in for a Workers KV namespace.
export function fakeKv() {
  const data = new Map();
  return {
    data,
    get: async (k, type) => (data.has(k) ? (type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null),
    put: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const sub = (n) => ({ endpoint: `https://web.push.apple.com/phone-${n}`, keys: { p256dh: "BPhone", auth: "auth" }, expirationTime: null });

test("a phone is saved with its bells, can change them, and can be removed; junk is refused", async () => {
  const kv = fakeKv();
  assert.equal(await savePhone(kv, sub(1), ["cfb:1"], 5), true);
  assert.deepEqual(await listPhones(kv), [{ subscription: { endpoint: sub(1).endpoint, keys: sub(1).keys }, bells: ["cfb:1"], at: 5 }]);
  assert.equal(await setBells(kv, sub(1).endpoint, ["cfb:1", "nfl:2"], 6), true);
  assert.deepEqual((await listPhones(kv))[0].bells, ["cfb:1", "nfl:2"]);
  assert.equal(await setBells(kv, sub(2).endpoint, ["cfb:1"]), false);  // not saved
  assert.equal(await savePhone(kv, { endpoint: "http://insecure" }, []), false);
  assert.equal(await savePhone(kv, sub(3), "cfb:1"), false);
  await removePhone(kv, sub(1).endpoint);
  assert.deepEqual(await listPhones(kv), []);
});

test("sending reaches the phones picked, and forgets one whose push service says it's gone", async (t) => {
  const kv = fakeKv();
  await savePhone(kv, sub(1), ["cfb:1"]);
  await savePhone(kv, sub(2), []);
  await savePhone(kv, sub(3), ["cfb:1"]);
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => { asked.push(url); return new Response(null, { status: url.endsWith("3") ? 410 : 201 }); });
  // Real keys for encrypting: a phone's P-256 public key and a 16-byte auth secret.
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  for (const [k, v] of kv.data) kv.data.set(k, JSON.stringify({ ...JSON.parse(v), subscription: { ...JSON.parse(v).subscription, keys: { p256dh, auth: "AAAAAAAAAAAAAAAAAAAAAA" } } }));
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const env = { PUSH: kv, VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey("jwk", vapid.privateKey)) };
  const belled = (await listPhones(kv)).filter((phone) => phone.bells.includes("cfb:1"));
  const result = await sendToPhones(env, { title: "t", body: "b", key: "cfb:1" }, belled);
  assert.deepEqual(result, { sent: 1, gone: [sub(3).endpoint] });
  assert.deepEqual(asked.sort(), [sub(1).endpoint, sub(3).endpoint]);  // not phone 2, whose bells don't include it
  assert.deepEqual((await listPhones(kv)).map((p) => p.subscription.endpoint).sort(), [sub(1).endpoint, sub(2).endpoint]);  // 3 forgotten
});
