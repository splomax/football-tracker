// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshen } from "../js/espn.js";

const game = (over = {}) => ({
  key: "cfb:1", state: "in", detail: "13:11 - 1st", clock: "13:11", period: 1, possession: "2", ddText: "1st & 10 at ILL 25", lastPlay: "kickoff",
  away: { id: "1", abbr: "ORE", score: "0" }, home: { id: "2", abbr: "ILL", score: "0" }, ...over,
});
// The latest play from ESPN's play-by-play (js/espn.js fetchSummary).
const play = (period, clock, away, home, over = {}) => ({ period: { number: period }, clock: { displayValue: clock }, awayScore: away, homeScore: home,
  text: "J.Davison rush for 2 yards", type: { text: "Rush" }, end: { team: { id: "1" }, downDistanceText: "1st & 10 at ILL 12", yardLine: 12, distance: 10 }, ...over });

test("a scoreboard stuck behind its play-by-play takes the play-by-play's clock, score, ball and last play", () => {
  // Seen live: the scoreboard sat at 13:11 in the 1st, 0-0, while the play-by-play had Oregon driving and scoring.
  const g = freshen(game(), play(1, "11:40", 7, 0));
  assert.deepEqual([g.clock, g.period, g.detail, g.away.score, g.home.score, g.possession, g.ddText, g.redZone, g.lastPlay],
    ["11:40", 1, "11:40 - 1st", "7", "0", "1", "1st & 10 at ILL 12", true, "J.Davison rush for 2 yards"]);
});

test("a scoreboard further along than the play-by-play keeps its own", () => {
  const g = freshen(game({ clock: "8:18", detail: "8:18 - 1st" }), play(1, "8:53", 7, 0));
  assert.deepEqual([g.clock, g.away.score, g.ddText], ["8:18", "0", "1st & 10 at ILL 25"]);
});

test("the play-by-play starts a game the scoreboard still calls upcoming, and reads the end of a quarter as such", () => {
  assert.equal(freshen(game({ state: "pre", period: 0, clock: "0:00" }), play(1, "14:52", 0, 0)).state, "in");
  const half = freshen(game({ period: 2, clock: "1:05", detail: "1:05 - 2nd" }), play(2, "0:00", 14, 10, { type: { text: "End Period" }, end: {} }));
  assert.deepEqual([half.detail, half.possession, half.ddText], ["Halftime", undefined, undefined]);
});

test("a tie keeps the scoreboard's: college overtime has no clock, and a stale play-by-play can't win on it", () => {
  // Seen live: IU 13, MICH 6 in OT on the scoreboard; the play-by-play's last play, also OT 0:00, still at 6-6.
  const g = freshen(game({ period: 5, clock: "0:00", detail: "OT", away: { id: "1", abbr: "IU", score: "13" }, home: { id: "2", abbr: "MICH", score: "6" } }),
    play(5, "0:00", 6, 6));
  assert.deepEqual([g.away.score, g.home.score], ["13", "6"]);
  // Later on the clock but with fewer points doesn't add up: keep the scoreboard's.
  assert.equal(freshen(game({ away: { id: "1", abbr: "ORE", score: "7" } }), play(1, "10:00", 0, 0)).away.score, "7");
  // Same moment, more points (the scoreboard missed a score): the play-by-play's.
  assert.equal(freshen(game({ period: 5, clock: "0:00", detail: "OT" }), play(5, "0:00", 6, 0)).away.score, "6");
});

test("the play-by-play's End of Game makes a game final while the scoreboard still says End of 4th", () => {
  const end = (period, away, home) => play(period, "0:00", away, home, { type: { text: "End of Game" }, text: "End of 4th quarter.", end: {} });
  // Seen live: USC @ Wisconsin, 7-24, in progress on the scoreboard 6 minutes after the final whistle.
  const g = freshen(game({ period: 4, clock: "0:00", detail: "End of 4th Quarter" }), end(4, 7, 24));
  assert.deepEqual([g.state, g.detail, g.away.score, g.home.score, g.possession], ["post", "Final", "7", "24", undefined]);
  assert.equal(freshen(game({ period: 5, clock: "0:00", detail: "OT" }), end(5, 13, 6)).detail, "Final/OT");
  assert.equal(freshen(game({ period: 7, clock: "0:00", detail: "3OT" }), end(7, 21, 19)).detail, "Final/3OT");
  // Tied: overtime is next, except after an NFL overtime.
  assert.equal(freshen(game({ period: 4, clock: "0:00" }), end(4, 17, 17)).state, "in");
  assert.equal(freshen(game({ key: "nfl:1", period: 5, clock: "0:00" }), end(5, 20, 20)).state, "post");
});

test("a finished game, or no play-by-play yet, keeps the scoreboard's", () => {
  assert.equal(freshen(game({ state: "post", detail: "Final" }), play(4, "0:00", 30, 20)).away.score, "0");
  assert.equal(freshen(game(), null).clock, "13:11");
});
