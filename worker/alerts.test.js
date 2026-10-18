// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTry, gameAlerts, mergeAlerts, periodName, sampleAlert, SAMPLE_KINDS } from "../js/alerts.js";

// A live game as js/espn.js normalizes it; override what each step changes.
const game = (over = {}) => ({
  key: "nfl:1", state: "in", detail: "10:00 - 1st", clock: "10:00", period: 1, redZone: false, possession: "2",
  away: { id: "1", abbr: "BUF", score: "0", logo: "buf.png" }, home: { id: "2", abbr: "NE", score: "0", logo: "ne.png" }, ddText: "1st & 10 at NE 30",
  ...over,
  ...(over.away && { away: { id: "1", abbr: "BUF", score: "0", logo: "buf.png", ...over.away } }),
  ...(over.home && { home: { id: "2", abbr: "NE", score: "0", logo: "ne.png", ...over.home } }),
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
  const [alert] = gameAlerts(game(), game({ away: { score: "3" }, lastPlay: "J.Bass 40 yd field goal", lastPlayScored: true }), memo, 5000);
  assert.deepEqual(alert, { title: "BUF field goal", body: "BUF 3, NE 0 · 10:00 - 1st\nJ.Bass 40 yd field goal", tag: "nfl:1:score:1:5000", icon: "buf.png" });
});

test("scores are named by points; a made extra point is skipped, a 2-point conversion is news", () => {
  const memo = {};
  const polls = [game(), game({ home: { score: "6" } }), game({ home: { score: "7" } }), game({ home: { score: "7" }, away: { score: "2" } }),
    game({ home: { score: "13" }, away: { score: "2" } }), game({ home: { score: "15" }, away: { score: "2" } })];
  const alerts = polls.slice(1).map((g, i) => gameAlerts(polls[i], g, memo, (i + 1) * 10_000));
  assert.deepEqual(alerts.map((a) => a.map((x) => x.title)),
    [["TD NE"], [], ["BUF 2 points"], ["TD NE"], ["2-pt conversion NE"]]);
  assert.equal(alerts[4][0].body, "BUF @ NE\nBUF 2, NE 15");
});

test("a touchdown and its try in the same update come as one", () => {
  const td = (score, extra) => {
    const memo = {};
    gameAlerts(undefined, game(), memo);
    return gameAlerts(game(), game({ home: { score }, ...extra }), memo, 10_000).map((a) => a.title);
  };
  assert.deepEqual(td("7"), ["TD NE"]);
  assert.deepEqual(td("8"), ["TD NE · 2-pt conversion"]);
  assert.deepEqual(td("6", { lastPlay: "D.Maye 12 Yd pass to H.Henry (A.Borregales PAT failed)", lastPlayScored: true }), ["TD NE · Missed PAT"]);
});

test("a missed extra point or failed 2-point try, seen in the touchdown's play a few updates later, is news", () => {
  for (const [text, headline] of [["(A.Borregales PAT blocked)", "Missed PAT NE"], ["(Two-Point Run Conversion Failed)", "Failed 2-pt NE"]]) {
    const memo = {};
    const polls = [game(), game({ home: { score: "6" } }), game({ home: { score: "6" }, scoringPlay: "R.Stevenson 1 Yd Run (A.Borregales Kick)" }),
      game({ home: { score: "6" }, scoringPlay: `R.Stevenson 1 Yd Run ${text}` }), game({ home: { score: "6" }, scoringPlay: `R.Stevenson 1 Yd Run ${text}` })];
    const alerts = polls.slice(1).map((g, i) => gameAlerts(polls[i], g, memo, (i + 1) * 10_000));
    assert.deepEqual(alerts.map((a) => a.map((x) => x.title)), [["TD NE"], [], [headline], []]);
    assert.equal(alerts[2][0].body, "BUF @ NE\nBUF 0, NE 6");
    assert.equal(alerts[2][0].icon, "ne.png");
  }
});

test("it stops watching for the try after a few minutes, or once the other team scores", () => {
  const failed = { home: { score: "6" }, scoringPlay: "x (Two-Point Pass Conversion Failed)" };
  let memo = {};
  gameAlerts(undefined, game(), memo);
  gameAlerts(game(), game({ home: { score: "6" } }), memo, 0);
  assert.deepEqual(gameAlerts(game({ home: { score: "6" } }), game(failed), memo, 5 * 60_000), []);
  memo = {};
  gameAlerts(undefined, game(), memo);
  gameAlerts(game(), game({ home: { score: "6" } }), memo, 0);
  gameAlerts(game({ home: { score: "6" } }), game({ home: { score: "6" }, away: { score: "3" } }), memo, 10_000);
  assert.deepEqual(gameAlerts(game({ home: { score: "6" }, away: { score: "3" } }), game({ ...failed, away: { score: "3" } }), memo, 20_000), []);
});

test("classifyTry reads ESPN's wording for each kind of try", () => {
  assert.equal(classifyTry("J.Smith 5 Yd pass from B.Jones (J.Bates Kick)"), "kick");
  assert.equal(classifyTry("J.Smith 5 Yd Run (J.Bates PAT failed)"), "missed-pat");
  assert.equal(classifyTry("J.Smith 5 Yd Run (J.Bates PAT Failed)"), "missed-pat");
  assert.equal(classifyTry("J.Smith 5 Yd Run (J.Bates PAT blocked)"), "missed-pat");
  assert.equal(classifyTry("J.Smith 5 Yd Run (B.Jones Pass to J.Smith for Two-Point Conversion)"), "two-point");
  assert.equal(classifyTry("J.Smith 5 Yd Run (B.Jones Run for Two-Point Conversion)"), "two-point");
  assert.equal(classifyTry("J.Smith 5 Yd Run (Two-Point Pass Conversion Failed)"), "failed-two-point");
  assert.equal(classifyTry("J.Smith 5 Yd Run (Two-Point Run Conversion Failed)"), "failed-two-point");
  assert.equal(classifyTry("J.Smith 5 Yd Run"), null);
  assert.equal(classifyTry(undefined), null);
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

test("kickoff, the end and start of each quarter (once two polls show it), halftime, overtime and the final", () => {
  assert.deepEqual(run(
    game({ state: "pre", period: 0, detail: "Sun 1:00 PM", clock: "0:00" }),
    game({ period: 1, clock: "15:00", detail: "15:00 - 1st" }),
    game({ period: 1, clock: "14:40", detail: "14:40 - 1st" }),
    game({ period: 1, clock: "0:00", detail: "End of 1st Quarter" }),
    game({ period: 2, clock: "15:00", detail: "15:00 - 2nd" }),
    game({ period: 2, clock: "14:30", detail: "14:30 - 2nd" }),
    game({ period: 2, clock: "0:00", detail: "Halftime" }),
    game({ period: 3, clock: "15:00", detail: "15:00 - 3rd" }),
    game({ period: 3, clock: "14:55", detail: "14:55 - 3rd" }),
    game({ period: 4, clock: "14:20", detail: "14:20 - 4th" }),  // missed the end of the 3rd
    game({ period: 4, clock: "14:00", detail: "14:00 - 4th" }),
    game({ period: 4, clock: "0:00", detail: "End of 4th Quarter" }),
    game({ period: 5, clock: "10:00", detail: "10:00 - OT" }),
    game({ period: 5, clock: "9:30", detail: "9:30 - OT" }),
    game({ state: "post", period: 5, clock: "0:00", detail: "Final/OT" }),
    game({ state: "post", period: 5, clock: "0:00", detail: "Final/OT" }),
  ), [[], [], ["Kickoff"], ["End of the 1st quarter"], [], ["Start of the 2nd quarter"], ["Halftime"], [], ["Start of the 3rd quarter"],
    [], ["End of the 3rd quarter", "Start of the 4th quarter"], ["End of the 4th quarter"], [], ["Start of the overtime"], ["Final"], []]);
});

test("ESPN showing the next quarter for one poll before the end of this one doesn't swallow the end", () => {
  // Seen live: period 2 for a single poll in the last seconds of the 1st, then "End of 1st" for minutes.
  assert.deepEqual(run(
    game({ period: 1, clock: "0:08", detail: "0:08 - 1st" }),
    game({ period: 2, clock: "15:00", detail: "15:00 - 2nd" }),
    game({ period: 1, clock: "0:00", detail: "End of 1st" }),
    game({ period: 1, clock: "0:00", detail: "End of 1st" }),
    game({ period: 2, clock: "15:00", detail: "15:00 - 2nd" }),
    game({ period: 2, clock: "14:51", detail: "14:51 - 2nd" }),
  ), [[], [], ["End of the 1st quarter"], [], [], ["Start of the 2nd quarter"]]);
});

test("a game first seen at halftime or over doesn't announce anything old", () => {
  assert.deepEqual(run(game({ period: 2, detail: "Halftime", clock: "0:00" }), game({ period: 3, detail: "15:00 - 3rd", clock: "15:00" }),
    game({ period: 3, detail: "14:50 - 3rd", clock: "14:50" })), [[], [], ["Start of the 3rd quarter"]]);
  assert.deepEqual(run(game({ state: "post", period: 4, detail: "Final" }), game({ state: "post", period: 4, detail: "Final" })), [[], []]);
});

test("one poll's notifications for a game merge into one, with the score line once", () => {
  const memo = {};
  const before = game({ period: 4, clock: "0:00", detail: "0:00 - 4th", home: { score: "20" } });
  gameAlerts(undefined, before, memo);
  const after = game({ state: "post", period: 4, clock: "0:00", detail: "Final", home: { score: "23" }, lastPlay: "Kick is good", lastPlayScored: true });
  assert.deepEqual(mergeAlerts(gameAlerts(before, after, memo, 1)),
    { title: "NE field goal · Final", body: "BUF 0, NE 23 · Final\nKick is good", tag: "nfl:1:score:2:1", icon: "ne.png" });
  assert.equal(mergeAlerts([{ title: "Halftime", body: "x" }]).title, "Halftime");
});

test("period names", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(periodName),
    ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter", "overtime", "2nd overtime", "3rd overtime"]);
});

test("a score notification quotes the scoring play: the one looked up by the score, else the last play only if it scored", () => {
  const body = (over) => {
    const memo = {};
    gameAlerts(undefined, game(), memo);
    return gameAlerts(game(), game({ home: { score: "3" }, ...over }), memo)[0].body;
  };
  // Seen live: ESPN had JAX's new score while its last play was still the play before the score. (Touchdowns are styled
  // without the play; this is for the others, a field goal here.)
  assert.equal(body({ lastPlay: "T.Lawrence pass incomplete short left", lastPlayScored: false }), "BUF 0, NE 3 · 10:00 - 1st");
  assert.equal(body({ lastPlay: "T.Lawrence pass incomplete short left", lastPlayScored: false, scoringPlay: "Cam Little 48 Yd Field Goal" }),
    "BUF 0, NE 3 · 10:00 - 1st\nCam Little 48 Yd Field Goal");
  assert.equal(body({ lastPlay: "C.Little 48 yard field goal is GOOD", lastPlayScored: true }), "BUF 0, NE 3 · 10:00 - 1st\nC.Little 48 yard field goal is GOOD");
});

test("a touchdown reads: the game, then TD and the team, then the new score; with other news it shares the middle line", () => {
  const memo = {};
  gameAlerts(undefined, game(), memo);
  const [td] = gameAlerts(game(), game({ away: { score: "7" }, scoringPlay: "never quoted" }), memo);
  assert.deepEqual({ title: td.title, body: td.body }, { title: "TD BUF", body: "BUF @ NE\nBUF 7, NE 0" });
  const end = {};
  const before = game({ period: 4, clock: "0:03", detail: "0:03 - 4th" });
  gameAlerts(undefined, before, end);
  const merged = mergeAlerts(gameAlerts(before, game({ state: "post", period: 4, clock: "0:00", detail: "Final", home: { score: "6" } }), end));
  assert.deepEqual({ title: merged.title, body: merged.body }, { title: "TD NE · Final", body: "BUF @ NE\nBUF 0, NE 6" });
});

test("each sample kind reads exactly like a real notification of that kind, and only that one", () => {
  const g = game({ period: 3, clock: "6:06", detail: "6:06 - 3rd", away: { id: "1", abbr: "HOU", score: "31" }, home: { id: "2", abbr: "JAX", score: "28" } });
  const titles = Object.fromEntries(Object.keys(SAMPLE_KINDS).map((k) => [k, sampleAlert(g, k)?.title ?? null]));
  assert.deepEqual(titles, {
    test: null, touchdown: "TD HOU", "missed-pat": "Missed PAT HOU", "two-point": "2-pt conversion HOU", "failed-two-point": "Failed 2-pt HOU", "field-goal": "HOU field goal", "red-zone": "HOU in the red zone",
    "two-minute": "Two-minute warning", kickoff: "Kickoff", "quarter-start": "Start of the 3rd quarter",
    "quarter-end": "End of the 1st quarter", halftime: "Halftime", final: "Final",
  });
  assert.equal(sampleAlert(g, "touchdown").body, "HOU @ JAX\nHOU 38, JAX 28");
  assert.equal(sampleAlert(g, "missed-pat").body, "HOU @ JAX\nHOU 31, JAX 28");
  assert.equal(sampleAlert(g, "two-point").body, "HOU @ JAX\nHOU 33, JAX 28");
  assert.equal(sampleAlert(g, "failed-two-point").body, "HOU @ JAX\nHOU 31, JAX 28");
  assert.equal(sampleAlert(g, "nonsense"), null);
});

test("each score is a new notification (its own tag)", () => {
  const memo = {};
  const polls = [game(), game({ home: { score: "6" } }), game({ home: { score: "8" } }), game({ home: { score: "11" } })];
  gameAlerts(undefined, polls[0], memo);
  const [td] = gameAlerts(polls[0], polls[1], memo, 10_000);
  const [two] = gameAlerts(polls[1], polls[2], memo, 40_000);
  const [fg] = gameAlerts(polls[2], polls[3], memo, 400_000);
  assert.equal(new Set([td.tag, two.tag, fg.tag]).size, 3);
  // Seen live: a second test field goal only replaced the first, out of sight. Each sample is its own notification.
  const g = game({ away: { id: "1", abbr: "HOU", score: "3" } });
  const first = sampleAlert(g, "field-goal");
  const second = sampleAlert(g, "field-goal");
  assert.notEqual(first.tag, second.tag);
});

test("a score's notification shows the scoring team's logo; others leave the picture to the default (the football)", () => {
  const memo = {};
  gameAlerts(undefined, game(), memo);
  assert.equal(gameAlerts(game(), game({ home: { score: "7" } }), memo, 1)[0].icon, "ne.png");
  const g = game({ period: 2, clock: "0:00", detail: "Halftime" });
  assert.equal(sampleAlert(g, "halftime").icon, undefined);
  assert.equal(sampleAlert(g, "field-goal").icon, "buf.png");
});

test("notifications call the teams by ESPN's short name", () => {
  const named = (over) => game({ ...over, away: { name: "Cardinals", ...over?.away }, home: { name: "Rams", ...over?.home } });
  const memo = {};
  gameAlerts(undefined, named(), memo);
  const [a] = gameAlerts(named(), named({ away: { score: "7" } }), memo, 10_000);
  assert.deepEqual([a.title, a.body], ["TD Cardinals", "Cardinals @ Rams\nCardinals 7, Rams 0"]);
});
