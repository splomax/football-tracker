// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreKeeper } from "./scorekeeper-object.js";
import { savePhone, setKinds } from "./phones.js";
import { fakeKv } from "./phones.test.js";

const live = (key, over = {}) => ({
  key, state: "in", detail: "10:00 - 1st", clock: "10:00", period: 1, redZone: false, possession: "2", date: new Date(0),
  away: { id: "1", abbr: "BUF", score: "0" }, home: { id: "2", abbr: "NE", score: "0" }, ...over,
});

// A Durable Object with stand-ins: Cloudflare's storage (the alarm, and the games' memos), KV holding phones (all
// turned on by an admin), ESPN (its scoreboards, and each game's scoring plays in `plays`), the clock, and Apple (every
// push lands in `pushed`, by phone).
async function setUp(t, { phones = {}, publicPhones = {}, version = "v1" } = {}) {
  let alarm = null, now = 1_000_000;
  const espn = { cfb: [], nfl: [] }, plays = {}, pushed = [], pending = [], stored = new Map();
  const ctx = {
    storage: {
      getAlarm: async () => alarm, setAlarm: async (at) => { alarm = at; }, deleteAlarm: async () => { alarm = null; },
      get: async (k) => stored.get(k), put: async (k, v) => { stored.set(k, structuredClone(v)); }, delete: async (k) => stored.delete(k),
      list: async ({ prefix }) => new Map([...stored].filter(([k]) => k.startsWith(prefix))),
    },
    abort: (reason) => { throw new Error(reason); },
    waitUntil: (p) => pending.push(p),
  };
  const kv = fakeKv();
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  // phones: turned on by an admin; publicPhones: by anyone else.
  for (const [list, admin] of [[phones, true], [publicPhones, false]]) {
    for (const [name, bells] of Object.entries(list)) {
      await savePhone(kv, { endpoint: `https://web.push.apple.com/${name}`, keys: { p256dh, auth: "AAAAAAAAAAAAAAAAAAAAAA" } }, bells, 0, admin);
    }
  }
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const env = { PUSH: kv, VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey("jwk", vapid.privateKey)), VERSION: { id: version } };
  t.mock.method(globalThis, "fetch", async (url) => {
    pushed.push(String(url).split("/").pop());
    return new Response(null, { status: String(url).endsWith("gone") ? 410 : 201 });
  });
  const obj = new ScoreKeeper(ctx, env, { fetchGames: async (league) => espn[league], fetchSummary: async (g) => ({ scoringPlays: plays[g.key] ?? [], latest: null }), now: () => now, testDelay: 0 });
  const req = (path, init = {}) => obj.fetch(new Request(`https://scorekeeper${path}`, { ...init, headers: { "X-Version": version, ...init.headers } }));
  // Firing the alarm, as Cloudflare does: it's cleared first, then the handler runs.
  const fire = async () => { alarm = null; await obj.alarm(); };
  return { obj, espn, plays, pushed, kv, req, fire, alarm: () => alarm, tick: (ms) => { now += ms; }, settle: () => Promise.all(pending) };
}

test("a page asking gets the games and keeps it fetching every 10 seconds", async (t) => {
  const s = await setUp(t);
  s.espn.nfl = [live("nfl:1")];
  const body = await (await s.req("/")).json();
  assert.equal(body.games.nfl.length, 1);
  assert.equal(s.alarm(), 1_000_000 + 10_000);
});

test("with no page and no phone bell on a game still to come, it sets no alarm", async (t) => {
  const s = await setUp(t, { phones: { a: [] } });
  await s.req("/wake");
  assert.equal(s.alarm(), null);
});

test("a phone's bell on a live game keeps it fetching, and each notification goes to the phones whose bells include it", async (t) => {
  const s = await setUp(t, { phones: { belled: ["nfl:1"], other: ["nfl:2"] } });
  s.espn.nfl = [live("nfl:1"), live("nfl:2")];
  await s.req("/wake");
  assert.equal(s.alarm(), 1_000_000);  // just started, knows no games: fetch right away
  await s.fire();  // first fetch: nothing is news yet
  assert.deepEqual(s.pushed, []);
  assert.equal(s.alarm(), 1_000_000 + 10_000);  // live and belled: every 10 seconds
  s.espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } }), live("nfl:2", { home: { id: "2", abbr: "NE", score: "3" } })];
  s.plays["nfl:1"] = [{ id: "a", kind: "touchdown", teamId: "2", text: "x (A.B Kick)", awayScore: 0, homeScore: 7 }];
  s.plays["nfl:2"] = [{ id: "b", kind: "field-goal", teamId: "2", text: "x", awayScore: 0, homeScore: 3 }];
  s.tick(10_000);
  await s.fire();
  assert.deepEqual(s.pushed.sort(), ["belled", "other"]);  // each to its own game's phone only
  s.pushed.length = 0;
  s.tick(10_000);
  await s.fire();
  assert.deepEqual(s.pushed, []);  // nothing new, nothing sent
});

test("each device gets only the kinds of notification it chose for that game", async (t) => {
  const s = await setUp(t, { phones: { defaults: ["nfl:1"], picky: ["nfl:1"], pickyElsewhere: ["nfl:1"] } });
  await setKinds(s.kv, "https://web.push.apple.com/picky", { "nfl:1": ["turnover"] });
  await setKinds(s.kv, "https://web.push.apple.com/pickyElsewhere", { "nfl:2": ["turnover"] });
  s.espn.nfl = [live("nfl:1")];
  await s.req("/wake");
  await s.fire();
  s.espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "3" } })];
  s.plays["nfl:1"] = [{ id: "b", kind: "field-goal", teamId: "2", text: "x", awayScore: 0, homeScore: 3 }];
  s.tick(10_000);
  await s.fire();
  assert.deepEqual(s.pushed.sort(), ["defaults", "pickyElsewhere"]);
});

test("the test button reaches only admins' phones whose bells include the game; a phone Apple says is gone is dropped", async (t) => {
  const s = await setUp(t, { phones: { a: ["cfb:9"], gone: ["cfb:9"], unbelled: ["cfb:1"] }, publicPhones: { visitor: ["cfb:9"] } });
  s.espn.cfb = [live("cfb:9")];
  await s.req("/");
  assert.equal((await s.req("/test", { method: "POST", body: JSON.stringify({ key: "cfb:9" }) })).status, 200);
  await s.settle();
  assert.deepEqual(s.pushed.sort(), ["a", "gone"]);  // not "unbelled" (bells), nor "visitor" (not an admin's)
  assert.equal((await s.kv.list({ prefix: "phone:" })).keys.length, 3);  // "gone" forgotten
  s.pushed.length = 0;
  await s.req("/test", { method: "POST", body: JSON.stringify({ key: "cfb:9" }) });
  await s.settle();
  assert.deepEqual(s.pushed, ["a"]);
});

test("a request from newer code makes an outdated program reset itself", async (t) => {
  const s = await setUp(t, { version: "v1" });
  await assert.rejects(s.obj.fetch(new Request("https://scorekeeper/", { headers: { "X-Version": "v2" } })), /newer code deployed/);
});
