// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { gameAlerts, periodName } from "../js/alerts.js";

// A live game as js/espn.js normalizes it; override what each step changes.
const game = (over = {}) => ({
  key: "nfl:1", state: "in", detail: "10:00 - 1st", clock: "10:00", period: 1, redZone: false, possession: "2",
  away: { id: "1", abbr: "BUF", score: "0" }, home: { id: "2", abbr: "NE", score: "0" }, ddText: "1st & 10 at NE 30",
  ...over,
  ...(over.away && { away: { id: "1", abbr: "BUF", score: "0", ...over.away } }),
  ...(over.home && { home: { id: "2", abbr: "NE", score: "0", ...over.home } }),
});

// Feeds the polls through one memo, as the page does; returns each poll's titles.
function run(...polls) {
  const memo = {};
  let prev, at = 0;
  return polls.map((g) => {
    const alerts = gameAlerts(prev, g, memo, (at += 10_000));
    prev = g;
    return alerts.map((a) => a.title);
  });
}

test("the first look is never news", () => {
  assert.deepEqual(run(game({ redZone: true, away: { score: "7" } })), [[]]);
  assert.deepEqual(run(game({ detail: "End of 1st Quarter", clock: "0:00" })), [[]]);
});

test("every notification carries the score and where the game is", () => {
  const memo = {};
  gameAlerts(undefined, game(), memo);
  const [alert] = gameAlerts(game(), game({ away: { score: "3" }, lastPlay: "J.Bass 40 yd field goal" }), memo);
  assert.deepEqual(alert, { title: "BUF field goal", body: "BUF 3, NE 0 · 10:00 - 1st\nJ.Bass 40 yd field goal", tag: "nfl:1:score:1", silent: false });
});

test("scores are named by points, and a touchdown's extra point updates it quietly", () => {
  const memo = {};
  const polls = [game(), game({ home: { score: "6" } }), game({ home: { score: "7" } }), game({ home: { score: "7" }, away: { score: "2" } })];
  const alerts = polls.slice(1).map((g, i) => gameAlerts(polls[i], g, memo, (i + 1) * 10_000));
  assert.deepEqual(alerts.map((a) => a.map(({ title, silent }) => [title, silent])),
    [[["NE touchdown", false]], [["NE extra point", true]], [["BUF 2 points", false]]]);
  // Two minutes on, a new score from the same team alerts again.
  const later = gameAlerts(polls[3], game({ home: { score: "10" }, away: { score: "2" } }), memo, 200_000);
  assert.equal(later[0].silent, false);
});

test("one red-zone notification per trip, until the other team has had the ball", () => {
  assert.deepEqual(run(
    game(),
    game({ redZone: true, ddText: "1st & 10 at BUF 15" }),
    game({ redZone: true, possession: undefined }),  // ESPN drops possession between plays
    game({ redZone: false }),                         // pushed back out by a penalty
    game({ redZone: true }),
    game({ possession: "1" }),                        // turnover
    game({ possession: "2", redZone: true }),
  ), [[], ["NE in the red zone"], [], [], [], [], ["NE in the red zone"]]);
});

test("the two-minute warning, in the 2nd and 4th quarters only", () => {
  assert.deepEqual(run(
    game({ period: 2, clock: "2:31", detail: "2:31 - 2nd" }),
    game({ period: 2, clock: "2:00", detail: "2:00 - 2nd" }),
    game({ period: 2, clock: "1:40", detail: "1:40 - 2nd" }),
  ), [[], ["Two-minute warning"], []]);
  assert.deepEqual(run(game({ period: 3, clock: "2:10" }), game({ period: 3, clock: "1:55" })), [[], []]);
  assert.deepEqual(run(game({ period: 4, clock: "3:05" }), game({ period: 4, clock: "1:12" })), [[], ["Two-minute warning"]]);
});

test("kickoff, the end and start of each quarter, halftime, overtime and the final", () => {
  assert.deepEqual(run(
    game({ state: "pre", period: 0, detail: "Sun 1:00 PM", clock: "0:00" }),
    game({ period: 1, clock: "15:00", detail: "15:00 - 1st" }),
    game({ period: 1, clock: "0:00", detail: "End of 1st Quarter" }),
    game({ period: 2, clock: "15:00", detail: "15:00 - 2nd" }),
    game({ period: 2, clock: "0:00", detail: "Halftime" }),
    game({ period: 3, clock: "15:00", detail: "15:00 - 3rd" }),
    game({ period: 4, clock: "14:20", detail: "14:20 - 4th" }),  // missed the end of the 3rd
    game({ period: 4, clock: "0:00", detail: "End of 4th Quarter" }),
    game({ period: 5, clock: "10:00", detail: "10:00 - OT" }),
    game({ state: "post", period: 5, clock: "0:00", detail: "Final/OT" }),
    game({ state: "post", period: 5, clock: "0:00", detail: "Final/OT" }),
  ), [[], ["Kickoff"], ["End of the 1st quarter"], ["Start of the 2nd quarter"], ["Halftime"], ["Start of the 3rd quarter"],
    ["End of the 3rd quarter", "Start of the 4th quarter"], ["End of the 4th quarter"], ["Start of the overtime"], ["Final"], []]);
});

test("a game first seen at halftime or over doesn't announce anything old", () => {
  assert.deepEqual(run(game({ period: 2, detail: "Halftime", clock: "0:00" }), game({ period: 3, detail: "15:00 - 3rd", clock: "15:00" })),
    [[], ["Start of the 3rd quarter"]]);
  assert.deepEqual(run(game({ state: "post", period: 4, detail: "Final" }), game({ state: "post", period: 4, detail: "Final" })), [[], []]);
});

test("period names", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(periodName),
    ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter", "overtime", "2nd overtime", "3rd overtime"]);
});
