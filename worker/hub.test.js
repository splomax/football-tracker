// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub, POLL_MS, IDLE_MS } from "./hub.js";

// A live game as js/espn.js normalizes it.
const game = (key, over = {}) => ({
  key, state: "in", detail: "10:00 - 1st", clock: "10:00", period: 1, redZone: false, possession: "2", date: new Date(0),
  away: { id: "1", abbr: "BUF", score: "0" }, home: { id: "2", abbr: "NE", score: "0" }, ...over,
});

// A hub whose ESPN is `espn` (league -> games, or an Error to throw) and whose clock moves only when told.
function hubWith(espn) {
  let t = 1_000_000;
  const hub = new Hub({ fetchGames: async (league) => { const v = espn[league]; if (v instanceof Error) throw v; return v ?? []; }, now: () => t });
  return { hub, espn, tick: (ms) => (t += ms) };
}

test("a page just starting gets the games and the newest id, but no old notifications", async () => {
  const { hub, espn, tick } = hubWith({ nfl: [game("nfl:1")] });
  await hub.feed(null);
  espn.nfl = [game("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } })];
  tick(POLL_MS);
  await hub.poll();
  const first = await hub.feed(null);
  assert.equal(first.games.nfl.length, 1);
  assert.deepEqual(first.alerts, []);
  assert.equal(first.cursor, 1);
});

test("a page gets the notifications after the last one it saw, each with its game's key and the score", async () => {
  const { hub, espn, tick } = hubWith({ nfl: [game("nfl:1"), game("nfl:2")] });
  const { cursor } = await hub.feed(null);
  espn.nfl = [game("nfl:1", { home: { id: "2", abbr: "NE", score: "3" }, lastPlay: "FG good" }), game("nfl:2")];
  tick(POLL_MS);
  const next = await hub.feed(cursor);  // stale, so it polls first
  assert.deepEqual(next.alerts.map(({ key, title, body }) => ({ key, title, body })),
    [{ key: "nfl:1", title: "NE field goal", body: "BUF 0, NE 3 · 10:00 - 1st\nFG good" }]);
  assert.deepEqual((await hub.feed(next.cursor)).alerts, []);
});

test("one poll's news for a game comes as one notification", async () => {
  const { hub, espn, tick } = hubWith({ nfl: [game("nfl:1", { period: 4, clock: "0:05", detail: "0:05 - 4th" })] });
  const { cursor } = await hub.feed(null);
  espn.nfl = [game("nfl:1", { state: "post", period: 4, clock: "0:00", detail: "Final", home: { id: "2", abbr: "NE", score: "3" } })];
  tick(POLL_MS);
  const { alerts } = await hub.feed(cursor);
  assert.deepEqual(alerts.map((a) => a.title), ["NE field goal · Final"]);
});

test("a league that fails or comes back empty keeps its last games", async () => {
  const { hub, espn, tick } = hubWith({ nfl: [game("nfl:1")], cfb: [game("cfb:1")] });
  await hub.feed(null);
  espn.nfl = new Error("offline");
  espn.cfb = [];
  tick(POLL_MS);
  const { games } = await hub.feed(null);
  assert.deepEqual([games.nfl.length, games.cfb.length], [1, 1]);
});

test("asking again within POLL_MS doesn't poll ESPN again", async () => {
  let fetches = 0;
  let t = 0;
  const hub = new Hub({ fetchGames: async () => { fetches++; return []; }, now: () => t });
  await hub.feed(null);
  t += POLL_MS - 1;
  await hub.feed(null);
  assert.equal(fetches, 2);  // one poll: both leagues
  t += 1;
  await hub.feed(null);
  assert.equal(fetches, 4);
});

test("it stays active while pages keep asking, and goes idle IDLE_MS after the last one", async () => {
  const { hub, tick } = hubWith({});
  await hub.feed(null);
  tick(IDLE_MS - 1);
  assert.equal(hub.active, true);
  tick(1);
  assert.equal(hub.active, false);
});

test("the test button sends a forced notification for that game through the feed; an unknown game is refused", async () => {
  const { hub } = hubWith({ cfb: [game("cfb:9", { away: { id: "1", abbr: "OSU", score: "3" }, home: { id: "2", abbr: "IU", score: "0" } })] });
  const { cursor } = await hub.feed(null);
  assert.equal(hub.test("cfb:9"), true);
  assert.equal(hub.test("cfb:404"), false);
  const { alerts } = await hub.feed(cursor);
  assert.equal(alerts.length, 1);
  assert.deepEqual({ ...alerts[0], id: undefined, at: undefined },
    { id: undefined, at: undefined, key: "cfb:9", title: "Test notification", body: "OSU 3, IU 0 · 10:00 - 1st\nSent through the backend", forced: true });
});
