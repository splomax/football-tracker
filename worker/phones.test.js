// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { savePhone, setBells, setKinds, removePhone, listPhones, sendToPhones } from "./phones.js";

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

test("a tester (marked by hand in KV) stays one when its device subscribes again", async () => {
  const kv = fakeKv();
  await savePhone(kv, sub(1), ["cfb:1"], 5);
  const [{ name }] = (await kv.list({ prefix: "phone:" })).keys;
  await kv.put(name, JSON.stringify({ ...(await kv.get(name, "json")), tester: true }));
  await savePhone(kv, sub(1), ["cfb:2"], 6);
  assert.equal((await listPhones(kv))[0].tester, true);
  await setBells(kv, sub(1).endpoint, ["cfb:3"], 7);
  assert.equal((await listPhones(kv))[0].tester, true);
});

test("a phone is saved with its bells, can change them, and can be removed; junk is refused", async () => {
  const kv = fakeKv();
  assert.equal(await savePhone(kv, sub(1), ["cfb:1"], 5), true);
  assert.deepEqual(await listPhones(kv), [{ subscription: { endpoint: sub(1).endpoint, keys: sub(1).keys }, bells: ["cfb:1"], public: true, at: 5 }]);
  assert.equal(await setBells(kv, sub(1).endpoint, ["cfb:1", "nfl:2"], 6), true);
  assert.deepEqual((await listPhones(kv))[0].bells, ["cfb:1", "nfl:2"]);
  // An admin's device: saved by a logged-in admin, or a public one whose admin logs in and changes its bells.
  await savePhone(kv, sub(4), [], 7, true);
  assert.equal((await listPhones(kv)).find((p) => p.subscription.endpoint === sub(4).endpoint).public, false);
  await setBells(kv, sub(1).endpoint, ["cfb:1"], 8, true);
  assert.equal((await listPhones(kv)).find((p) => p.subscription.endpoint === sub(1).endpoint).public, false);
  await removePhone(kv, sub(4).endpoint);
  assert.equal(await setBells(kv, sub(2).endpoint, ["cfb:1"]), false);  // not saved
  assert.equal(await savePhone(kv, { endpoint: "http://insecure" }, []), false);
  assert.equal(await savePhone(kv, sub(3), "cfb:1"), false);
  await removePhone(kv, sub(1).endpoint);
  assert.deepEqual(await listPhones(kv), []);
});

test("an admin's device keeps the kinds it chose for each game; everyone else's never have any", async () => {
  const kv = fakeKv();
  await savePhone(kv, sub(1), ["cfb:1"], 1, true, { "cfb:1": ["touchdown"] });
  assert.deepEqual((await listPhones(kv))[0].kinds, { "cfb:1": ["touchdown"] });
  assert.equal(await setKinds(kv, sub(1).endpoint, { "cfb:2": ["turnover", "final"] }), true);
  await setBells(kv, sub(1).endpoint, ["cfb:2"], 2, true);
  await savePhone(kv, sub(1), ["cfb:2"], 3, true);  // subscribing again without kinds keeps them
  assert.deepEqual((await listPhones(kv))[0].kinds, { "cfb:2": ["turnover", "final"] });
  await savePhone(kv, sub(2), [], 4, false, { "cfb:1": ["touchdown"] });
  assert.equal((await listPhones(kv)).find((p) => p.subscription.endpoint === sub(2).endpoint).kinds, undefined);
  assert.equal(await setKinds(kv, sub(3).endpoint, { "cfb:1": ["final"] }), false);  // not saved
  assert.equal(await setKinds(kv, sub(1).endpoint, ["final"]), false);  // by game, not one list
  assert.equal(await setKinds(kv, sub(1).endpoint, { "cfb:1": "final" }), false);
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
