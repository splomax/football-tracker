// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreKeeper, POLL_MS, IDLE_MS } from "./scorekeeper.js";

const game = (key) => ({ key, state: "in", date: new Date(0), away: { abbr: "BUF", score: "0" }, home: { abbr: "NE", score: "0" } });

// A keeper whose ESPN is `espn` (league -> games, or an Error to throw) and whose clock moves only when told.
function keeperWith(espn) {
  let t = 1_000_000, fetches = 0;
  const keeper = new ScoreKeeper({ now: () => t, fetchGames: async (league) => {
    fetches++;
    const v = espn[league];
    if (v instanceof Error) throw v;
    return v ?? [];
  } });
  return { keeper, espn, tick: (ms) => (t += ms), fetches: () => fetches };
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
