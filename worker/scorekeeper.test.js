// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreKeeper, POLL_MS, IDLE_MS } from "./scorekeeper.js";

const game = (key) => ({ key, state: "in", date: new Date(0), away: { abbr: "BUF", score: "0" }, home: { abbr: "NE", score: "0" } });

// A keeper whose ESPN is `espn` (league -> games, or an Error to throw) and whose clock moves only when told.
function keeperWith(espn) {
  let t = 1_000_000, fetches = 0;
  const scoring = {};  // each game's scoring plays, as ESPN's game detail lists them
  const keeper = new ScoreKeeper({ now: () => t, fetchSummary: async (g) => ({ scoringPlays: scoring[g.key] ?? [], latest: null }), fetchGames: async (league) => {
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

const play = (id, kind, away, home, text = "x") => ({ id, kind, teamId: away > home ? "1" : "2", text, awayScore: away, homeScore: home });

// A live game with scores and a clock, for the notification tests.
const live = (key, over = {}) => ({
  key, state: "in", detail: "10:00 - 1st", clock: "10:00", period: 1, redZone: false, possession: "2", date: new Date(0),
  away: { id: "1", abbr: "BUF", score: "0" }, home: { id: "2", abbr: "NE", score: "0" }, ...over,
});

test("a page just opening gets the newest notification's number, but none of the old notifications", async () => {
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1")] });
  await keeper.ask();
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } })];
  scoring["nfl:1"] = [play("a", "touchdown", 0, 7, "x (A.B Kick)")];
  tick(POLL_MS);
  await keeper.poll();
  const first = await keeper.ask(null);
  assert.deepEqual(first.alerts, []);
  assert.equal(first.cursor, 1);
});

test("a page gets the notifications after the last one it saw, each with its game and the score", async () => {
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1"), live("nfl:2")] });
  const { cursor } = await keeper.ask(null);
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "3" } }), live("nfl:2")];
  scoring["nfl:1"] = [play("f", "field-goal", 0, 3, "FG good")];
  tick(POLL_MS);
  const next = await keeper.ask(cursor);
  assert.deepEqual(next.alerts.map(({ key, title, body }) => ({ key, title, body })),
    [{ key: "nfl:1", title: "NE field goal", body: "BUF 0, NE 3 · 10:00 - 1st\nFG good" }]);
  assert.deepEqual((await keeper.ask(next.cursor)).alerts, []);
});

test("one update's news for a game comes as one notification", async () => {
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1", { period: 4, clock: "0:05", detail: "0:05 - 4th" })] });
  const { cursor } = await keeper.ask(null);
  espn.nfl = [live("nfl:1", { state: "post", period: 4, clock: "0:00", detail: "Final", home: { id: "2", abbr: "NE", score: "3" } })];
  scoring["nfl:1"] = [play("f", "field-goal", 0, 3)];
  tick(POLL_MS);
  assert.deepEqual((await keeper.ask(cursor)).alerts.map((a) => a.title), ["NE field goal · Final"]);
});

test("the test button sends that game a notification marked as a test; an unknown game is refused", async () => {
  const { keeper } = keeperWith({ cfb: [live("cfb:9", { away: { id: "1", abbr: "OSU", score: "3" }, home: { id: "2", abbr: "IU", score: "0" } })] });
  const { cursor } = await keeper.ask(null);
  assert.equal(keeper.test("cfb:9").title, "Test notification");
  assert.equal(keeper.test("cfb:404"), null);
  const [alert] = (await keeper.ask(cursor)).alerts;
  assert.deepEqual({ key: alert.key, title: alert.title, body: alert.body, test: alert.test },
    { key: "cfb:9", title: "Test notification", body: "OSU 3, IU 0 · 10:00 - 1st\nSent through the Game Tracker server", test: true });
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
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1")] });
  await keeper.poll();
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } })];
  scoring["nfl:1"] = [play("a", "touchdown", 0, 7, "x (A.B Kick)")];
  tick(POLL_MS);
  await keeper.poll();
  assert.deepEqual(keeper.since(0).map((a) => a.title), ["TD NE"]);
  assert.deepEqual(keeper.since(1), []);
});

test("the scoring plays are fetched only when the score moved past them (or a try is pending), and a field goal quotes its play", async () => {
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1")] });
  let asked = 0;
  const fetchDetail = keeper.fetchSummary;
  keeper.fetchSummary = async (g) => { asked++; return fetchDetail(g); };
  const { cursor } = await keeper.ask(null);
  tick(POLL_MS);
  await keeper.ask(cursor);
  assert.equal(asked, 0);  // the score hasn't moved
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "3" } })];
  scoring["nfl:1"] = [play("f", "field-goal", 0, 3, "A.Borregales 44 Yd Field Goal")];
  tick(POLL_MS);
  const [alert] = (await keeper.ask(cursor)).alerts;
  assert.equal(alert.body, "BUF 0, NE 3 · 10:00 - 1st\nA.Borregales 44 Yd Field Goal");
  tick(POLL_MS);
  await keeper.ask(cursor);
  assert.equal(asked, 1);  // caught up: no more fetching
});

test("the test button can send a sample of one kind instead of the plain test", async () => {
  const { keeper } = keeperWith({ cfb: [live("cfb:9")] });
  const { cursor } = await keeper.ask(null);
  assert.equal(keeper.test("cfb:9", "halftime").title, "Halftime");
  assert.equal(keeper.test("cfb:9").title, "Test notification");
  assert.deepEqual((await keeper.ask(cursor)).alerts.map((a) => [a.title, a.test]), [["Halftime", true], ["Test notification", true]]);
});

test("after a touchdown it keeps reading the touchdown's play, so a missed extra point (the score unchanged) is news", async () => {
  const { keeper, espn, scoring, tick } = keeperWith({ nfl: [live("nfl:1")] });
  const { cursor } = await keeper.ask(null);
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "6" } })];
  scoring["nfl:1"] = [play("t", "touchdown", 0, 6, "R.Stevenson 1 Yd Run")];
  tick(POLL_MS);
  await keeper.poll();
  scoring["nfl:1"] = [play("t", "touchdown", 0, 6, "R.Stevenson 1 Yd Run (A.Borregales PAT failed)")];
  tick(POLL_MS);
  const { alerts } = await keeper.ask(cursor);
  assert.deepEqual(alerts.map((a) => a.title), ["TD NE", "Missed PAT NE"]);
});

test("each game's memo is saved, so a restarted keeper neither repeats nor misses a notification", async () => {
  const stored = new Map();
  const storage = { put: async (k, v) => { stored.set(k, structuredClone(v)); }, delete: async (k) => stored.delete(k),
    list: async ({ prefix }) => new Map([...stored].filter(([k]) => k.startsWith(prefix))) };
  const espn = { nfl: [live("nfl:1")] }, scoring = {};
  const make = () => new ScoreKeeper({ storage, now: () => 1, fetchSummary: async (g) => ({ scoringPlays: scoring[g.key] ?? [], latest: null }), fetchGames: async (l) => espn[l] ?? [] });
  let keeper = make();
  await keeper.poll();
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "7" } })];
  scoring["nfl:1"] = [play("a", "touchdown", 0, 7, "x (A.B Kick)")];
  await keeper.poll();
  assert.deepEqual(keeper.since(0).map((a) => a.title), ["TD NE"]);
  keeper = make();  // restarted: the touchdown's already sent; a field goal while it was down still goes out
  espn.nfl = [live("nfl:1", { home: { id: "2", abbr: "NE", score: "10" } })];
  scoring["nfl:1"].push(play("b", "field-goal", 0, 10));
  await keeper.poll();
  assert.deepEqual(keeper.since(0).map((a) => a.title), ["NE field goal"]);
});

