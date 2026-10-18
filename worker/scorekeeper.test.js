// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreKeeper, POLL_MS, IDLE_MS } from "./scorekeeper.js";

const game = (key) => ({ key, state: "in", date: new Date(0), away: { abbr: "BUF", score: "0" }, home: { abbr: "NE", score: "0" } });

// A keeper whose ESPN is `espn` (league -> games, or an Error to throw) and whose clock moves only when told.
function keeperWith(espn) {
  let t = 1_000_000, fetches = 0;
  const scoring = { text: null };  // what ESPN's game detail lists for the latest score
  const keeper = new ScoreKeeper({ now: () => t, fetchScoringPlay: async () => scoring.text, fetchGames: async (league) => {
    fetches++;
    const v = espn[league];
    if (v instanceof Error) throw v;
    return v ?? [];
  } });
  return { keeper, espn, scoring, tick: (ms) => (t += ms), fetches: () => fetches };
}

test("a page asking gets both leagues' games, fetched first when they're stale", async () => {
  const { keeper } = keeperWith({ nfl: [game("nfl:1")], cfb: [game("cfb:1"), game("cfb:2")] });
  const { games, confNames } = await keeper.ask();
  assert.deepEqual([games.nfl.length, games.cfb.length], [1, 2]);
  assert.equal(typeof confNames, "object");
});

test("asking again within POLL_MS doesn't ask ESPN again", async () => {
  const { keeper, tick, fetches } = keeperWith({});
  await keeper.ask();
  assert.equal(fetches(), 2);  // one fetch: both leagues
  tick(POLL_MS - 1);
  await keeper.ask();
  assert.equal(fetches(), 2);
  tick(1);
  await keeper.ask();
  assert.equal(fetches(), 4);
});

test("a league that fails or comes back empty keeps its last games", async () => {
  const { keeper, espn, tick } = keeperWith({ nfl: [game("nfl:1")], cfb: [game("cfb:1")] });
  await keeper.ask();
  espn.nfl = new Error("offline");
  espn.cfb = [];
  tick(POLL_MS);
  const { games } = await keeper.ask();
  assert.deepEqual([games.nfl.length, games.cfb.length], [1, 1]);
});

test("it keeps going while pages keep asking, and stops IDLE_MS after the last one", async () => {
  const { keeper, tick } = keeperWith({});
  assert.equal(keeper.watched, false);  // nobody has asked yet
  await keeper.ask();
  tick(IDLE_MS - 1);
  assert.equal(keeper.watched, true);
  tick(1);
  assert.equal(keeper.watched, false);
});

// A live game with scores and a clock, for the notification tests.
const live = (key, over = {}) => ({
  key, state: "in", detail: "10:00 - 1st", clock: "10:00", period: 1, redZone: false, possession: "2", date: new Date(0),
  away: { id: "1", abbr: "BUF", score: "0" }, home: { id: "2", abbr: "NE", score: "0" }, ...over,
});

test("a page just opening gets the newest notification's number, but none of the old notifications", async () => {
  const { keeper, espn, tick } = keeperWith({ nfl: [live("nfl:1")] });
  await keeper.ask();
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } })];
  tick(POLL_MS);
  await keeper.poll();
  const first = await keeper.ask(null);
  assert.deepEqual(first.alerts, []);
  assert.equal(first.cursor, 1);
});

test("a page gets the notifications after the last one it saw, each with its game and the score", async () => {
  const { keeper, espn, tick } = keeperWith({ nfl: [live("nfl:1"), live("nfl:2")] });
  const { cursor } = await keeper.ask(null);
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "3" }, lastPlay: "FG good", lastPlayScored: true }), live("nfl:2")];
  tick(POLL_MS);
  const next = await keeper.ask(cursor);
  assert.deepEqual(next.alerts.map(({ key, title, body }) => ({ key, title, body })),
    [{ key: "nfl:1", title: "NE field goal", body: "BUF 0, NE 3 · 10:00 - 1st\nFG good" }]);
  assert.deepEqual((await keeper.ask(next.cursor)).alerts, []);
});

test("one update's news for a game comes as one notification", async () => {
  const { keeper, espn, tick } = keeperWith({ nfl: [live("nfl:1", { period: 4, clock: "0:05", detail: "0:05 - 4th" })] });
  const { cursor } = await keeper.ask(null);
  espn.nfl = [live("nfl:1", { state: "post", period: 4, clock: "0:00", detail: "Final", home: { id: "2", abbr: "NE", score: "3" } })];
  tick(POLL_MS);
  assert.deepEqual((await keeper.ask(cursor)).alerts.map((a) => a.title), ["NE field goal · Final"]);
});

test("the test button sends that game a notification marked as a test; an unknown game is refused", async () => {
  const { keeper } = keeperWith({ cfb: [live("cfb:9", { away: { id: "1", abbr: "OSU", score: "3" }, home: { id: "2", abbr: "IU", score: "0" } })] });
  const { cursor } = await keeper.ask(null);
  assert.equal(keeper.test("cfb:9").title, "Test notification");
  assert.equal(keeper.test("cfb:404"), null);
  const [alert] = (await keeper.ask(cursor)).alerts;
  assert.deepEqual({ key: alert.key, title: alert.title, body: alert.body, forced: alert.forced },
    { key: "cfb:9", title: "Test notification", body: "OSU 3, IU 0 · 10:00 - 1st\nSent through the Game Tracker server", forced: true });
});

test("it fetches every 10 seconds while a page is watching or a phone's bell is on a live or about-to-start game, every 15 minutes for later games, and not at all otherwise", async () => {
  const at = (mins) => new Date(1_000_000 + mins * 60_000);
  const { keeper, tick } = keeperWith({ cfb: [
    live("cfb:live"),
    { ...live("cfb:soon"), state: "pre", date: at(10) },
    { ...live("cfb:later"), state: "pre", date: at(120) },
    { ...live("cfb:over"), state: "post" },
  ] });
  await keeper.poll();  // fetched, but no page has asked
  const wake = (bells) => keeper.nextWake([{ bells }]);
  assert.equal(wake([]), null);
  assert.equal(wake(["cfb:over"]), null);
  assert.equal(wake(["cfb:later"]), 15 * 60_000);
  assert.equal(wake(["cfb:later", "cfb:soon"]), POLL_MS);
  assert.equal(wake(["cfb:live"]), POLL_MS);
  assert.equal(wake(["cfb:unknown"]), 15 * 60_000);  // not fetched yet: look again soon
  assert.equal(keeper.nextWake([]), null);
  await keeper.ask();
  assert.equal(keeper.nextWake([]), POLL_MS);  // a page is watching
  tick(IDLE_MS);
  assert.equal(keeper.nextWake([]), null);
});

test("since(id) lists the notifications after id, for sending to phones", async () => {
  const { keeper, espn, tick } = keeperWith({ nfl: [live("nfl:1")] });
  await keeper.poll();
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } })];
  tick(POLL_MS);
  await keeper.poll();
  assert.deepEqual(keeper.since(0).map((a) => a.title), ["NE touchdown"]);
  assert.deepEqual(keeper.since(1), []);
});

test("when the scoreboard's last play isn't the scoring one, the score notification quotes the scoring play looked up by the score", async () => {
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1")] });
  const { cursor } = await keeper.ask(null);
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" }, lastPlay: "Pass incomplete", lastPlayScored: false })];
  scoring.text = "R.Stevenson 4 Yd Run (A.Borregales Kick)";
  tick(POLL_MS);
  const [alert] = (await keeper.ask(cursor)).alerts;
  assert.equal(alert.body, "BUF 0, NE 7 · 10:00 - 1st\nR.Stevenson 4 Yd Run (A.Borregales Kick)");
});
